import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional
import anthropic
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.models.signals import Signal
from app.models.candles import Candle
from app.models.memory import MemoryEntry
from app.models.audit import AuditLog
from app.services.technical_analysis import analyze as ta_analyze
from app.services.token_tracker import usage_record, flush_usage
from app.services.notifications import NotificationService
from app.services.ai_guard import is_ai_paused, is_ai_failure, pause_ai

logger = logging.getLogger(__name__)

MIN_CONFIDENCE_GENERATE = 0.60
MIN_MENTIONS_NEWS = 1
MIN_MENTIONS_SOCIAL = 2

# Always-monitored assets — generate signals even without news/social data
DEFAULT_WATCHLIST: set[str] = {
    # Crypto
    "BTC", "ETH", "SOL", "DOGE", "AVAX",
    # US equities & ETFs
    "SPY", "QQQ", "NVDA", "TSLA", "META", "AAPL", "MSFT", "MSTR", "AMZN", "GOOGL",
    # Defense / Energy
    "LMT", "RTX", "XOM", "CVX", "XLE",
}

SIGNAL_PROMPT = """Analyseer {asset} en geef een handelssignaal. Weeg bull vs bear argumenten objectief.

Asset: {asset} | Prijs: ${price}
Nieuws: {news_summary}
Social: {social_summary}
TA: {ta_summary}

Geef ALLEEN dit JSON object:
{{
  "direction": "buy"|"sell"|"skip",
  "confidence": <0.55-1.0>,
  "bull_score": <0.0-1.0>,
  "bear_score": <0.0-1.0>,
  "bull_won": true|false,
  "key_catalyst": "<sterkste bull-argument, max 50 woorden>",
  "key_risk": "<grootste risico, max 50 woorden>",
  "bull_arguments": ["<arg1>", "<arg2>"],
  "bear_arguments": ["<arg1>", "<arg2>"],
  "price_target": <null of getal>,
  "downside_target": <null of getal>,
  "timeframe": "intraday"|"swing"|"positional",
  "reason": "<synthese max 100 woorden>",
  "suggested_entry": <null of getal>,
  "suggested_stop": <null of getal>,
  "suggested_take_profit": <null of getal>,
  "risk_reward": <null of getal>,
  "key_risks": "<max 40 woorden>",
  "invalidation": "<max 25 woorden>"
}}

Gebruik "skip" bij onvoldoende bewijs. Stop altijd onder entry (buy) of boven entry (sell). Risk/reward >= 1.5."""


class SignalGeneratorService:
    def __init__(self):
        self.settings = get_settings()

    async def generate_signals(self, lookback_hours: int = 24) -> int:
        """Generate signals via Bull/Bear debate. Returns count generated."""
        if is_ai_paused():
            logger.warning("AI analyse gepauzeerd - signaal generatie overgeslagen")
            return 0

        since = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

        async with AsyncSessionLocal() as db:
            news_result = await db.execute(
                select(NewsItem)
                .where(
                    NewsItem.ai_analyzed == True,
                    NewsItem.published_at >= since,
                    NewsItem.status != "noise",
                    NewsItem.impact_score >= 3,
                )
                .order_by(NewsItem.published_at.desc())
                .limit(200)
            )
            news_items = news_result.scalars().all()

            social_result = await db.execute(
                select(SocialPost)
                .where(
                    SocialPost.ai_analyzed == True,
                    SocialPost.posted_at >= since,
                    SocialPost.score >= 50,
                )
                .order_by(SocialPost.posted_at.desc())
                .limit(300)
            )
            social_posts = social_result.scalars().all()

        ticker_data = self._aggregate_by_ticker(news_items, social_posts)

        # Add watchlist tickers only when we have TA data for them (avoids wasting tokens on data-less tickers)
        for ticker in DEFAULT_WATCHLIST:
            if ticker not in ticker_data:
                ticker_data[ticker] = {"news_items": [], "social_posts": [], "news_sentiment_sum": 0, "social_hype_sum": 0, "_watchlist_only": True}

        if not ticker_data:
            logger.info("Geen tickers met voldoende data voor signaal generatie")
            return 0

        if not self.settings.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY niet geconfigureerd - signaal generatie overgeslagen")
            return 0

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        generated = 0

        for asset, data in list(ticker_data.items())[:15]:
            try:
                if await self._recent_signal_exists(asset):
                    continue

                candles = await self._get_candles(asset)
                ta_result = ta_analyze(candles) if candles else None
                price = candles[-1].close if candles else None

                # Skip watchlist-only tickers without TA data — nothing to analyse
                if data.get("_watchlist_only") and ta_result is None:
                    continue

                # Fetch memory lessons for this asset
                lessons = await self._get_memory_lessons(asset)

                # Build context strings
                news_items_asset = data["news_items"][:5]
                social_posts_asset = data["social_posts"][:5]

                news_summary = "\n".join([
                    f"- [{n.source}] {n.title[:80]} (sentiment: {n.sentiment}, impact: {n.impact_score:.0f}/10)"
                    for n in news_items_asset
                ]) or "Geen recent nieuws"

                social_summary = "\n".join([
                    f"- r/{p.subreddit}: score={p.score}, hype={p.hype_score:.2f} — {p.content[:80]}"
                    for p in social_posts_asset
                ]) or "Geen social media data"

                ta_summary = "Geen technische data"
                if ta_result:
                    rsi_str = f"{ta_result.rsi:.0f}" if ta_result.rsi is not None else "N/A"
                    ta_summary = (
                        f"Score: {ta_result.score:.2f} | RSI: {rsi_str} | "
                        f"MACD: {ta_result.macd_signal} | Trend: {ta_result.trend} | {ta_result.summary}"
                    )

                if lessons:
                    ta_summary += f"\n\n🧠 Geheugen — eerdere trades {asset} (BELANGRIJK: pas deze lessen toe):\n" + "\n".join(f"  {l}" for l in lessons)

                price_str = f"{price:.4f}" if price else "onbekend"

                # Single combined call (was 3 separate calls — saves ~67% tokens)
                signal_data, resp = self._call_signal_agent(
                    client, asset, price_str, news_summary, social_summary, ta_summary
                )

                # Track token usage
                async with AsyncSessionLocal() as db:
                    await flush_usage(db, [usage_record(self.settings.anthropic_model, "signal", resp.usage)])
                    await db.commit()

                if signal_data.get("direction") == "skip":
                    continue

                confidence = float(signal_data.get("confidence", 0))
                if confidence < MIN_CONFIDENCE_GENERATE:
                    continue

                # Build bull_data / bear_data from combined response for _save_signal compatibility
                bull_data = {
                    "bull_score": signal_data.get("bull_score"),
                    "key_catalyst": signal_data.get("key_catalyst"),
                    "bull_arguments": signal_data.get("bull_arguments", []),
                    "price_target": signal_data.get("price_target"),
                }
                bear_data = {
                    "bear_score": signal_data.get("bear_score"),
                    "key_risk": signal_data.get("key_risk"),
                    "bear_arguments": signal_data.get("bear_arguments", []),
                    "downside_target": signal_data.get("downside_target"),
                }

                await self._save_signal(asset, signal_data, data, ta_result, bull_data, bear_data)
                generated += 1
                logger.info(
                    f"Signaal gegenereerd: {asset} {signal_data['direction']} "
                    f"confidence={confidence:.2f} bull={signal_data.get('bull_score', 0):.2f} "
                    f"bear={signal_data.get('bear_score', 0):.2f}"
                )

            except Exception as e:
                logger.error(f"Signal generatie fout voor {asset}: {e}")
                if is_ai_failure(e):
                    await pause_ai("signal_generator", e)
                    break

        return generated

    def _call_signal_agent(self, client, asset: str, price: str,
                            news_summary: str, social_summary: str, ta_summary: str) -> tuple[dict, any]:
        prompt = SIGNAL_PROMPT.format(
            asset=asset,
            price=price,
            news_summary=news_summary,
            social_summary=social_summary,
            ta_summary=ta_summary,
        )
        response = client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end]), response
        return {"direction": "skip"}, response

    def _aggregate_by_ticker(self, news_items, social_posts) -> dict:
        data = {}
        for item in news_items:
            for ticker in (item.tickers or []):
                if len(ticker) < 2 or len(ticker) > 5:
                    continue
                if ticker not in data:
                    data[ticker] = {"news_items": [], "social_posts": [], "news_sentiment_sum": 0, "social_hype_sum": 0}
                data[ticker]["news_items"].append(item)
                data[ticker]["news_sentiment_sum"] += float(item.sentiment_score or 0) * float(item.impact_score or 5) / 10

        for post in social_posts:
            for ticker in (post.tickers or []):
                if len(ticker) < 2 or len(ticker) > 5:
                    continue
                if ticker not in data:
                    data[ticker] = {"news_items": [], "social_posts": [], "news_sentiment_sum": 0, "social_hype_sum": 0}
                data[ticker]["social_posts"].append(post)
                data[ticker]["social_hype_sum"] += float(post.hype_score or 0.3)

        filtered = {}
        for ticker, d in data.items():
            if len(d["news_items"]) >= MIN_MENTIONS_NEWS or len(d["social_posts"]) >= MIN_MENTIONS_SOCIAL:
                filtered[ticker] = d

        return dict(sorted(filtered.items(),
                           key=lambda x: len(x[1]["news_items"]) * 2 + len(x[1]["social_posts"]),
                           reverse=True))

    async def _recent_signal_exists(self, asset: str, hours: int = 6) -> bool:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Signal).where(
                    Signal.asset == asset,
                    Signal.created_at >= since,
                    Signal.status.in_(["pending", "paper_traded"]),
                ).limit(1)
            )
            return result.scalar_one_or_none() is not None

    async def _get_candles(self, symbol: str) -> list:
        from app.services.market_data_service import MarketDataService
        svc = MarketDataService()
        return await svc.get_candles(symbol, "1Day", 50)

    async def _get_memory_lessons(self, asset: str, limit: int = 6) -> list[str]:
        """Fetch recent trade lessons for this asset, including rule suggestions."""
        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(MemoryEntry).where(
                        MemoryEntry.memory_type == "trade_lesson",
                        MemoryEntry.related_symbols.contains([asset]),
                        MemoryEntry.status == "active",
                    ).order_by(MemoryEntry.importance.desc(), MemoryEntry.created_at.desc()).limit(limit)
                )
                entries = result.scalars().all()
                winning, losing, rules = [], [], []
                for e in entries:
                    try:
                        content = json.loads(e.content) if e.content else {}
                        lesson = content.get("lesson", "")
                        pattern = content.get("pattern", "unknown")
                        rule = content.get("rule_suggestion")
                        pnl = content.get("pnl")
                        pnl_str = f" (P&L: ${pnl:.2f})" if pnl is not None else ""
                        if lesson:
                            line = f"{lesson}{pnl_str}"
                            if pattern == "winning":
                                winning.append(f"✅ {line}")
                            else:
                                losing.append(f"❌ {line}")
                        if rule:
                            rules.append(f"📌 Regel: {rule}")
                    except Exception:
                        pass
                return rules + winning + losing
        except Exception:
            return []

    async def _save_signal(self, asset: str, signal_data: dict, agg_data: dict,
                            ta_result, bull_data: dict, bear_data: dict) -> Signal:
        expires = datetime.now(timezone.utc) + timedelta(hours=48)

        ai_analysis = {
            "direction": signal_data.get("direction"),
            "key_risks": signal_data.get("key_risks"),
            "invalidation": signal_data.get("invalidation"),
            "bull_won": signal_data.get("bull_won", False),
            # Bull agent
            "bull_score": bull_data.get("bull_score"),
            "bull_catalyst": bull_data.get("key_catalyst"),
            "bull_arguments": bull_data.get("bull_arguments", []),
            "bull_price_target": bull_data.get("price_target"),
            # Bear agent
            "bear_score": bear_data.get("bear_score"),
            "bear_risk": bear_data.get("key_risk"),
            "bear_arguments": bear_data.get("bear_arguments", []),
            "bear_downside": bear_data.get("downside_target"),
            # Data context
            "news_count": len(agg_data["news_items"]),
            "social_count": len(agg_data["social_posts"]),
            "ta_score": ta_result.score if ta_result else None,
            "ta_rsi": ta_result.rsi if ta_result else None,
            "ta_macd": ta_result.macd_signal if ta_result else None,
            "ta_trend": ta_result.trend if ta_result else None,
        }

        signal = Signal(
            asset=asset,
            direction=signal_data.get("direction", "buy"),
            timeframe=signal_data.get("timeframe", "swing"),
            reason=signal_data.get("reason", ""),
            confidence=float(signal_data.get("confidence", 0)),
            suggested_entry=signal_data.get("suggested_entry"),
            suggested_stop=signal_data.get("suggested_stop"),
            suggested_take_profit=signal_data.get("suggested_take_profit"),
            risk_reward=signal_data.get("risk_reward"),
            status="pending",
            ai_analysis=ai_analysis,
            expires_at=expires,
        )

        async with AsyncSessionLocal() as db:
            db.add(signal)

            # Audit log
            db.add(AuditLog(
                action="signal_generated",
                actor="signal_generator",
                entity_type="signal",
                details={
                    "asset": asset,
                    "direction": signal_data.get("direction"),
                    "confidence": float(signal_data.get("confidence", 0)),
                    "bull_score": bull_data.get("bull_score"),
                    "bear_score": bear_data.get("bear_score"),
                },
                status="success",
                message=f"{asset} {signal_data.get('direction')} confidence={signal_data.get('confidence', 0):.2f}",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))

            await db.commit()
            await db.refresh(signal)
            await NotificationService(db).send(
                "signal_generated",
                f"Trading OS - Nieuw signaal: {asset} {signal.direction.upper()}",
                (
                    f"Confidence: {signal.confidence:.0%}\n"
                    f"Timeframe: {signal.timeframe}\n"
                    f"Reden: {(signal.reason or 'Geen toelichting')[:300]}"
                ),
                severity="info",
                entity_type="signal",
                entity_id=signal.id,
            )

        return signal

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
from app.services.technical_analysis import analyze as ta_analyze

logger = logging.getLogger(__name__)

MIN_CONFIDENCE_GENERATE = 0.55
MIN_MENTIONS_NEWS = 1
MIN_MENTIONS_SOCIAL = 2

SIGNAL_PROMPT = """Je bent een trading analyst. Genereer een concreet trading signaal op basis van onderstaande data.

Asset: {asset}
Huidige prijs: ${price}

Nieuws sentiment (laatste 24u):
{news_summary}

Social media momentum:
{social_summary}

Technische analyse:
{ta_summary}

Geef ALLEEN JSON terug:
{{
  "direction": "buy" | "sell" | "skip",
  "confidence": <getal 0.0 tot 1.0>,
  "timeframe": "intraday" | "swing" | "positional",
  "reason": "<max 150 woorden over WHY dit signaal>",
  "suggested_entry": <prijs of null>,
  "suggested_stop": <stop loss prijs of null>,
  "suggested_take_profit": <target prijs of null>,
  "risk_reward": <getal of null>,
  "key_risks": "<max 50 woorden>",
  "invalidation": "<wanneer is dit signaal ongeldig>"
}}

Geef "skip" als er onvoldoende bewijs is. Wees conservatief — liever geen signaal dan een slecht signaal."""


class SignalGeneratorService:
    def __init__(self):
        self.settings = get_settings()

    async def generate_signals(self, lookback_hours: int = 24) -> int:
        """Generate signals based on analyzed news + social + TA. Returns count generated."""
        since = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

        # Collect analyzed news
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

        # Collect unique tickers with enough mentions
        ticker_data = self._aggregate_by_ticker(news_items, social_posts)
        if not ticker_data:
            logger.info("Geen tickers met voldoende data voor signaal generatie")
            return 0

        if not self.settings.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY niet geconfigureerd - signaal generatie overgeslagen")
            return 0

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        generated = 0

        for asset, data in list(ticker_data.items())[:10]:  # max 10 per run
            try:
                # Skip if recent signal already exists
                if await self._recent_signal_exists(asset):
                    continue

                # Get market data
                candles = await self._get_candles(asset)
                ta_result = ta_analyze(candles) if candles else None
                price = candles[-1].close if candles else None

                # Generate signal via Claude
                signal_data = self._call_claude(client, asset, price, data, ta_result)

                if signal_data.get("direction") == "skip":
                    continue

                confidence = float(signal_data.get("confidence", 0))
                if confidence < MIN_CONFIDENCE_GENERATE:
                    continue

                # Save signal
                await self._save_signal(asset, signal_data, data, ta_result)
                generated += 1
                logger.info(f"Signaal gegenereerd: {asset} {signal_data['direction']} confidence={confidence:.2f}")

            except Exception as e:
                logger.error(f"Signal generatie fout voor {asset}: {e}")

        return generated

    def _aggregate_by_ticker(self, news_items, social_posts) -> dict:
        """Aggregate mentions, sentiment, and hype per ticker."""
        data = {}

        for item in news_items:
            for ticker in (item.tickers or []):
                if len(ticker) < 2 or len(ticker) > 5:
                    continue
                if ticker not in data:
                    data[ticker] = {
                        "news_items": [], "social_posts": [],
                        "news_sentiment_sum": 0, "social_hype_sum": 0,
                    }
                data[ticker]["news_items"].append(item)
                data[ticker]["news_sentiment_sum"] += float(item.sentiment_score or 0) * float(item.impact_score or 5) / 10

        for post in social_posts:
            for ticker in (post.tickers or []):
                if len(ticker) < 2 or len(ticker) > 5:
                    continue
                if ticker not in data:
                    data[ticker] = {
                        "news_items": [], "social_posts": [],
                        "news_sentiment_sum": 0, "social_hype_sum": 0,
                    }
                data[ticker]["social_posts"].append(post)
                data[ticker]["social_hype_sum"] += float(post.hype_score or 0.3)

        # Filter: need minimum evidence
        filtered = {}
        for ticker, d in data.items():
            news_count = len(d["news_items"])
            social_count = len(d["social_posts"])
            if news_count >= MIN_MENTIONS_NEWS or social_count >= MIN_MENTIONS_SOCIAL:
                filtered[ticker] = d

        # Sort by combined evidence strength
        return dict(sorted(filtered.items(),
                           key=lambda x: len(x[1]["news_items"]) * 2 + len(x[1]["social_posts"]),
                           reverse=True))

    def _call_claude(self, client, asset: str, price: Optional[float], data: dict, ta_result) -> dict:
        news_items = data["news_items"][:5]
        social_posts = data["social_posts"][:5]

        news_summary = "\n".join([
            f"- [{n.source}] {n.title[:80]} (sentiment: {n.sentiment}, impact: {n.impact_score:.0f}/10)"
            for n in news_items
        ]) or "Geen recent nieuws"

        social_summary = "\n".join([
            f"- r/{p.subreddit}: score={p.score}, hype={p.hype_score:.2f} — {p.content[:80]}"
            for p in social_posts
        ]) or "Geen social media data"

        ta_summary = ta_result.summary if ta_result else "Geen technische data beschikbaar"
        if ta_result:
            rsi_str = f"{ta_result.rsi:.0f}" if ta_result.rsi is not None else "N/A"
            ta_summary = (
                f"Score: {ta_result.score:.2f} | RSI: {rsi_str} | "
                f"MACD: {ta_result.macd_signal} | Trend: {ta_result.trend} | {ta_result.summary}"
            )

        prompt = SIGNAL_PROMPT.format(
            asset=asset,
            price=f"{price:.2f}" if price else "onbekend",
            news_summary=news_summary,
            social_summary=social_summary,
            ta_summary=ta_summary,
        )

        response = client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        return {"direction": "skip"}

    async def _recent_signal_exists(self, asset: str, hours: int = 6) -> bool:
        """Check if a recent signal already exists for this asset."""
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

    async def _save_signal(self, asset: str, signal_data: dict, agg_data: dict, ta_result) -> Signal:
        expires = datetime.now(timezone.utc) + timedelta(hours=48)

        ai_analysis = {
            "direction": signal_data.get("direction"),
            "key_risks": signal_data.get("key_risks"),
            "invalidation": signal_data.get("invalidation"),
            "news_count": len(agg_data["news_items"]),
            "social_count": len(agg_data["social_posts"]),
            "ta_score": ta_result.score if ta_result else None,
            "ta_rsi": ta_result.rsi if ta_result else None,
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
            await db.commit()
            await db.refresh(signal)

        return signal

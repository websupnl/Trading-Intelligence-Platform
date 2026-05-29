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
from app.services.alpaca_broker import CRYPTO_SYMBOLS, is_crypto

logger = logging.getLogger(__name__)

MIN_CONFIDENCE_GENERATE = 0.60
MIN_CONFIDENCE_CRYPTO_SESSION = 0.50
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

SIGNAL_SYSTEM_PROMPT = """Je bent een gedisciplineerde trading analist voor een LONG-ONLY systeem. Je opereert volgens deze niet-onderhandelbare principes:

KERNFILOSOFIE
- De markt heeft een base rate: ~95% van potentiële trades is GEEN edge. Je default antwoord is SKIP, niet buy.
- Je verdient geld door verlies te VERMIJDEN, niet door winst te jagen. Een gemiste kans kost niets; een slechte trade kost echt geld.
- "Al ingeprijsd" is je belangrijkste check. Als breed nieuws bekend is, heeft de markt het al verwerkt.
- Sociale hype is meestal een contra-indicator, geen signaal. Hoe luider, hoe later je bent.
- Technische setups zonder fundamentele katalysator zijn coin flips. Fundamentele katalysatoren zonder technische bevestiging zijn premature.

EDGE-DEFINITIE (alleen BUY als minstens 2 hieronder waar zijn)
1. Asymmetrisch risico/reward: berekend R/R >= 2.0 met duidelijk invalidatieniveau
2. Niet-consensus inzicht: jij ziet iets dat retail nog niet ziet (zelden waar — wees eerlijk)
3. Multi-bron confirmatie: nieuws + TA + flow wijzen dezelfde kant op, onafhankelijk van elkaar
4. Concrete, dateerbare katalysator binnen je tijdshorizon (niet "ooit", maar "binnen 48u" / "deze week")
5. Liquide instrument met betrouwbare prijsstructuur (geen low-float pumps)

CONFIDENCE-CALIBRATIE (gebruik strikt deze ankers, geen tussenwaarden uitvinden)
- 0.60-0.64: Marginale edge, slecht slapen waard. Default voor "ik denk dat dit kan werken".
- 0.65-0.74: Duidelijk edge op meerdere assen, maar geen slam dunk. Sweet spot.
- 0.75-0.84: Sterke convergentie + concrete katalysator + technische setup. Zeldzaam (max ~10% van je signalen).
- 0.85-1.00: ALMOST NEVER. Alleen bij genuine arbitrage of asymmetric event-driven setup. Als je dit gebruikt zonder een specifieke katalysator binnen 24u, herzie.

STRATEGIE-CONTEXT
- Long-only: "sell" betekent UITSLUITEND een bestaande long positie sluiten, nooit short openen.
- Geen bestaande long? Dan geen sell. Gebruik "skip" voor bearish scenario's.
- Stop loss is verplicht en altijd onder entry (lange positie). R/R minimaal 2.0 voor een buy.
- Position sizing: 1-2% account risk per trade — entry/stop afstand moet realistisch zijn (geen 0.5% stops op volatile names).

ANTI-PATRONEN (automatische SKIP)
- "Het is al gestegen" = laat. Geen buy op extension zonder pullback/consolidation.
- Bekend nieuws (>24u oud) = al ingeprijsd. Skip.
- TA en nieuws conflicteren = onhelder. Skip.
- Lage liquiditeit + social hype = pump risico. Skip.
- Geen technische data + geen nieuws = je raadt. Skip.
- Eerdere trade in dezelfde asset verloor om dezelfde reden = leer ervan. Skip.

OUTPUT
- Geef ALLEEN geldig JSON. Geen uitleg ervoor of erna.
- Wees beknopt en concreet. Geen filler-woorden zoals "potentieel", "mogelijk", "zou kunnen".
- Reden moet specifiek zijn: WELKE katalysator, WAAROM nu, WAAR is je invalidatie.
"""


SIGNAL_USER_PROMPT = """Analyseer dit handelsidee voor {asset}.

═══ MARKTDATA ═══
Asset: {asset}
Huidige prijs: ${price}

═══ NIEUWS (laatste 24u) ═══
{news_summary}

═══ SOCIAL SENTIMENT ═══
{social_summary}

═══ TECHNISCHE ANALYSE ═══
{ta_summary}

═══ INSTRUCTIE ═══
Voer een interne bull/bear debate uit met deze stappen:

1. CHECK BASE RATE: Is er iets unieks aan deze setup, of past het in het 95% skip-bucket?
2. CHECK ALREADY-PRICED-IN: Is dit nieuws bekend? Is de prijs al bewogen? Wat is je niet-consensus inzicht?
3. BULL CASE: 2-3 sterkste argumenten met concrete katalysatoren en tijdshorizon
4. BEAR CASE: 2-3 sterkste tegenargumenten + grootste tail risk
5. SCORE: weeg objectief — als bear binnen 10 punten van bull is, kies SKIP (geen edge)
6. ALS BUY: bereken entry/stop/TP op realistische niveaus. R/R moet >= 2.0 zijn op je eigen getallen.
7. INVALIDATIE: één concrete observatie die zou bewijzen dat je fout zat (prijsniveau, nieuwsfeit)

Antwoord met dit exacte JSON-schema:
{{
  "direction": "buy" | "skip",
  "confidence": <0.60-0.84 — gebruik alleen ankerpunten uit kalibratie>,
  "bull_score": <0.0-1.0>,
  "bear_score": <0.0-1.0>,
  "bull_won": <true | false>,
  "already_priced_in": <true | false — eerlijke check>,
  "edge_criteria_met": <aantal van de 5 edge-criteria, 0-5>,
  "catalyst_window": "<binnen 24u | binnen 1week | langer | geen> — als 'geen', moet direction skip zijn",
  "key_catalyst": "<de ÉNE meest concrete bullish trigger, max 25 woorden>",
  "key_risk": "<het ÉNE grootste tail risk, max 25 woorden>",
  "bull_arguments": ["<concreet arg1>", "<concreet arg2>"],
  "bear_arguments": ["<concreet arg1>", "<concreet arg2>"],
  "price_target": <null of realistisch getal binnen 1-2 weken horizon>,
  "downside_target": <null of stop-niveau>,
  "timeframe": "intraday" | "swing" | "positional",
  "reason": "<specifieke synthese: welke katalysator + waarom nu + wat de markt mist, max 80 woorden>",
  "suggested_entry": <null of getal — liefst pullback/breakout level, niet huidige prijs als die extended is>,
  "suggested_stop": <null of getal — onder structuur, niet arbitrair %>,
  "suggested_take_profit": <null of getal — eerste resistance/measured move>,
  "risk_reward": <null of berekend ratio>,
  "key_risks": "<concrete tail risks, max 30 woorden>",
  "invalidation": "<exacte observatie die je fout zou bewijzen, max 20 woorden>"
}}

Onthoud: SKIP is een geldig, vaak beter antwoord. Het systeem rekent je niet af op gemiste kansen, wel op slechte trades."""

CRYPTO_SESSION_SYSTEM_PROMPT = """Je bent een crypto trader voor een PAPER trading systeem (geen echt geld). Je doel is actief handelen in crypto om het systeem te testen en van de markt te leren.

KERN: DIT IS PAPER TRADING — wees bereid te handelen
- Fouten kosten niets. Leren kost ook niets. Handelen kost ook niets.
- Een gemiste kans in paper trading is suboptimaal; een onnodige skip is een gemiste leerervaring.
- Je default is NIET meer automatisch "skip" — je default is actief nadenken of er een tradeable setup is.

WANNEER BUY (minstens 1 van deze geldt)
1. RSI < 38: oversold + prijs heeft steun; potentieel reversal of bounce.
2. RSI > 62 + bullish MACD: momentum bevestigd omhoog.
3. Prijs net boven recente support (EMA20/EMA50) na pullback.
4. Bullish nieuws of positief sentiment de afgelopen 24u.
5. BTC stijgt en altcoin volgt nog niet (lag play).

WANNEER SKIP (alleen dit)
- Geen prijsdata en geen TA beschikbaar (data compleet ontbreekt).
- Prijs in vrije val zonder enige steun in zicht (RSI < 20 met dalend volume).
- Duidelijk bearish breaking news dat de sector direct raakt.
- RSI > 80 (extreem overbought, geen entry).

CONFIDENCE GEBRUIK
- 0.50-0.54: dunne setup maar technisch net genoeg. Geldig voor paper trading.
- 0.55-0.64: goede TA setup, eventueel nieuws context.
- 0.65-0.75: sterke convergentie van TA + nieuws + momentum.
- Bull hoeft niet hoger dan bear te zijn voor een buy — bull >= 0.45 is voldoende als TA het ondersteunt.

RISK/REWARD
- Stop loss is verplicht bij buy: onder steun of EMA niveau.
- Take profit is verplicht: minimaal 1.5x de stop-afstand.
- Entry bij huidige prijs of net pullback.

OUTPUT
- Geef ALLEEN geldig JSON.
- direction is "buy" of "skip".
- Bij buy: stop loss en take profit verplicht.
- Reden: concreet en technisch (welk niveau, welke indicator, welk scenario)."""

# Backwards-compat alias (oude callers kunnen nog de combinatie krijgen)
SIGNAL_PROMPT = SIGNAL_SYSTEM_PROMPT + "\n\n" + SIGNAL_USER_PROMPT


class SignalGeneratorService:
    def __init__(self):
        self.settings = get_settings()

    async def generate_signals(self, lookback_hours: int = 24, crypto_session_mode: bool = False) -> int:
        """Generate signals via Bull/Bear debate. Returns count generated."""
        if is_ai_paused():
            logger.warning("AI analyse gepauzeerd - signaal generatie overgeslagen")
            return 0

        # In crypto session mode: look back 24h for news regardless of the passed lookback_hours
        effective_hours = max(lookback_hours, 24) if crypto_session_mode else lookback_hours
        # Lower impact threshold in crypto mode so crypto news (which scores lower) passes through
        min_impact = 2 if crypto_session_mode else 3
        since = datetime.now(timezone.utc) - timedelta(hours=effective_hours)

        async with AsyncSessionLocal() as db:
            news_result = await db.execute(
                select(NewsItem)
                .where(
                    NewsItem.ai_analyzed == True,
                    NewsItem.published_at >= since,
                    NewsItem.status != "noise",
                    NewsItem.impact_score >= min_impact,
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

        watchlist = sorted(CRYPTO_SYMBOLS) if crypto_session_mode else DEFAULT_WATCHLIST
        # Add watchlist tickers only when we have TA data for them (avoids wasting tokens on data-less tickers)
        for ticker in watchlist:
            if ticker not in ticker_data:
                ticker_data[ticker] = {"news_items": [], "social_posts": [], "news_sentiment_sum": 0, "social_hype_sum": 0, "_watchlist_only": True}

        if crypto_session_mode:
            ticker_data = {ticker: data for ticker, data in ticker_data.items() if is_crypto(ticker)}

        if not ticker_data:
            logger.info("Geen tickers met voldoende data voor signaal generatie")
            return 0

        if not self.settings.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY niet geconfigureerd - signaal generatie overgeslagen")
            return 0

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        generated = 0

        limit = 10 if crypto_session_mode else 15
        for asset, data in list(ticker_data.items())[:limit]:
            if is_ai_paused():
                logger.warning("AI analyse tijdens signaalbatch gepauzeerd - resterende assets overgeslagen")
                break
            try:
                if await self._recent_signal_exists(asset):
                    continue

                candles = await self._get_candles(asset)
                ta_result = ta_analyze(candles) if candles else None
                price = candles[-1].close if candles else None

                # In crypto session mode, skip only if BOTH TA and price are missing
                if data.get("_watchlist_only") and ta_result is None and not crypto_session_mode:
                    continue
                if data.get("_watchlist_only") and ta_result is None and price is None:
                    continue  # Truly no data at all

                if self._context_is_stale(data, hours=8, crypto_session_mode=crypto_session_mode, asset=asset):
                    await self._log_signal_skip(
                        asset,
                        "Context te oud voor nieuwe AI-call",
                        {
                            "direction": "skip",
                            "confidence": 0,
                            "reason": "Geen verse nieuws/social katalysator binnen 8 uur; AI-call overgeslagen om oude context en tokenkosten te vermijden.",
                        },
                        data,
                        ta_result,
                    )
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
                if is_ai_paused():
                    logger.warning("AI analyse vlak voor signaalcall gepauzeerd - resterende assets overgeslagen")
                    break
                signal_data, resp = self._call_signal_agent(
                    client, asset, price_str, news_summary, social_summary, ta_summary,
                    crypto_session_mode=crypto_session_mode,
                )

                # Track token usage
                async with AsyncSessionLocal() as db:
                    await flush_usage(db, [usage_record(self.settings.anthropic_model, "signal", resp.usage)])
                    await db.commit()

                if signal_data.get("direction") == "skip":
                    await self._log_signal_skip(asset, "AI koos SKIP", signal_data, data, ta_result)
                    continue

                confidence = float(signal_data.get("confidence", 0))
                min_confidence = MIN_CONFIDENCE_CRYPTO_SESSION if crypto_session_mode and is_crypto(asset) else MIN_CONFIDENCE_GENERATE
                if confidence < min_confidence:
                    await self._log_signal_skip(asset, f"Confidence te laag ({confidence:.0%})", signal_data, data, ta_result)
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

    def _context_is_stale(self, data: dict, hours: int = 8, crypto_session_mode: bool = False, asset: str | None = None) -> bool:
        if crypto_session_mode and asset and is_crypto(asset):
            return False
        if data.get("_watchlist_only"):
            return True
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        timestamps = []
        for item in data.get("news_items", []):
            if item.published_at:
                timestamps.append(item.published_at)
        for item in data.get("social_posts", []):
            if item.posted_at:
                timestamps.append(item.posted_at)
        if not timestamps:
            return True
        return max(timestamps) < cutoff

    async def _log_signal_skip(self, asset: str, reason: str, signal_data: dict, agg_data: dict, ta_result) -> None:
        async with AsyncSessionLocal() as db:
            db.add(AuditLog(
                action="signal_skipped",
                actor="signal_generator",
                entity_type="signal",
                entity_id=asset,
                details={
                    "asset": asset,
                    "skip_reason": reason,
                    "direction": signal_data.get("direction"),
                    "confidence": signal_data.get("confidence"),
                    "bull_score": signal_data.get("bull_score"),
                    "bear_score": signal_data.get("bear_score"),
                    "already_priced_in": signal_data.get("already_priced_in"),
                    "edge_criteria_met": signal_data.get("edge_criteria_met"),
                    "catalyst_window": signal_data.get("catalyst_window"),
                    "key_catalyst": signal_data.get("key_catalyst"),
                    "key_risk": signal_data.get("key_risk"),
                    "reason": signal_data.get("reason"),
                    "news_count": len(agg_data.get("news_items", [])),
                    "social_count": len(agg_data.get("social_posts", [])),
                    "ta_score": ta_result.score if ta_result else None,
                    "ta_summary": ta_result.summary if ta_result else None,
                },
                status="skipped",
                message=f"{asset}: {reason} - {signal_data.get('reason') or signal_data.get('key_risk') or 'geen edge'}",
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))
            await db.commit()

    def _call_signal_agent(self, client, asset: str, price: str,
                            news_summary: str, social_summary: str, ta_summary: str,
                            crypto_session_mode: bool = False) -> tuple[dict, any]:
        user_prompt = SIGNAL_USER_PROMPT.format(
            asset=asset,
            price=price,
            news_summary=news_summary,
            social_summary=social_summary,
            ta_summary=ta_summary,
        )
        # System prompt is gecached (zelfde voor elke call), user prompt bevat de variërende data.
        # Lage temperature voor consistente, gedisciplineerde reasoning.
        system_prompt = CRYPTO_SESSION_SYSTEM_PROMPT if crypto_session_mode and is_crypto(asset) else SIGNAL_SYSTEM_PROMPT
        system_blocks = [{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }] if self.settings.anthropic_enable_prompt_caching else system_prompt

        response = client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=800,
            temperature=0.45 if crypto_session_mode and is_crypto(asset) else 0.3,
            system=system_blocks,
            messages=[{"role": "user", "content": user_prompt}],
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
                    # skipped_funds en broker_error: account-probleem, niet een signal-probleem.
                    # Blokkeer ze wél om te voorkomen dat dezelfde call elke 5 min opnieuw draait.
                    Signal.status.in_(["pending", "paper_traded", "live_traded", "skipped_funds", "broker_error"]),
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

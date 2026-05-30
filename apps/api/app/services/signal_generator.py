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
from app.services.market_context import get_market_context, format_for_prompt

logger = logging.getLogger(__name__)

MIN_CONFIDENCE_GENERATE = 0.55
MIN_CONFIDENCE_CRYPTO_SESSION = 0.50
MIN_MENTIONS_NEWS = 1
MIN_MENTIONS_SOCIAL = 2

# Always-monitored assets — generate signals even without news/social data
DEFAULT_WATCHLIST: set[str] = {
    # Crypto large-cap
    "BTC", "ETH", "SOL", "DOGE", "AVAX", "XRP", "ADA", "LINK", "LTC",
    # Crypto mid-cap (meme/volatile)
    "AAVE", "UNI", "ALGO", "BAT", "CRV", "BCH",
    # US equities & ETFs
    "SPY", "QQQ", "NVDA", "TSLA", "META", "AAPL", "MSFT", "MSTR", "AMZN", "GOOGL",
    # High-momentum tech
    "AMD", "COIN", "PLTR", "CRWD", "HOOD",
}

SIGNAL_SYSTEM_PROMPT = """Je bent een actieve trading analist voor een LONG-ONLY systeem. Je doel is om tradeable setups te vinden en kapitaal actief in te zetten.

KERNFILOSOFIE
- De markt heeft kansen: ~70% van potentiële trades heeft geen scherpe edge, maar ~30% wel. Zoek die 30%.
- Zowel te veel als te weinig handelen is suboptimaal. Idle cash is ook een keuze — en vaak de verkeerde.
- TA-only setups zijn GELDIG: sterke RSI + trend + MACD alignment zonder nieuws is een legitieme reden voor een buy.
- Nieuws versterkt een TA-setup maar is geen vereiste. Technische structuur alleen is genoeg bij liquide assets.
- Sociale hype zonder TA-bevestiging = skip. TA zonder nieuws = geldig.

EDGE-DEFINITIE (BUY als minstens 1 hieronder waar is)
1. Asymmetrisch risico/reward: berekend R/R >= 1.5 met duidelijk invalidatieniveau
2. Sterke TA-setup: RSI oversold (<40) + steun + opwaartse trend, OF RSI momentum (>55) + MACD bullish crossover
3. Multi-bron confirmatie: nieuws + TA + sentiment wijzen dezelfde kant op
4. Concrete katalysator binnen je tijdshorizon (earnings, productlancering, macro event)
5. Liquide instrument met betrouwbare prijsstructuur

CONFIDENCE-CALIBRATIE
- 0.55-0.59: Dunne maar legitieme TA-setup. Geldig voor executie.
- 0.60-0.64: Duidelijke TA of licht nieuws. Goede trade.
- 0.65-0.74: Sterke convergentie van TA + context. Sweet spot.
- 0.75-0.84: Sterke convergentie + concrete katalysator. Zeldzaam.
- 0.85-1.00: Alleen bij asymmetrische event-driven setup binnen 24u.

STRATEGIE-CONTEXT
- Long-only: "sell" betekent UITSLUITEND een bestaande long positie sluiten, nooit short openen.
- Geen bestaande long? Dan geen sell. Gebruik "skip" voor bearish scenario's.
- Stop loss is verplicht en altijd onder entry. R/R minimaal 1.5 voor een buy.
- Position sizing: systeem bepaalt grootte automatisch — jij bepaalt alleen entry/stop/TP niveaus.

ANTI-PATRONEN (SKIP)
- Prijs in vrije val zonder enige steun (RSI < 20, dalend volume). Skip.
- TA en nieuws conflicteren sterk en onduidelijk. Skip.
- Lage liquiditeit + pure social hype zonder TA. Skip.
- Geen enkele technische data beschikbaar. Skip.
- Eerdere trade in dezelfde asset verloor om dezelfde reden. Skip.

OUTPUT
- Geef ALLEEN geldig JSON. Geen uitleg ervoor of erna.
- Wees concreet: WELKE technische setup, WAAROM nu, WAAR is je invalidatie.
- Bij twijfel tussen 0.55 en skip: kies 0.55. Idle cash is geen winst.
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

CRYPTO_SESSION_SYSTEM_PROMPT = """Je bent een actieve crypto trader voor een paper trading systeem. Je handelt in TWO MODI: bounces EN momentum. Beide zijn even geldig.

═══ SETUP TYPE 1: OVERSOLD BOUNCE ═══
Wanneer te kopen:
- RSI < 40 + prijs op steunniveau (EMA20, EMA50, recente low)
- Entry: bij huidige prijs of lichte daling
- Stop: onder recent low of steun
- Target: EMA20 of vorige weerstand (R/R >= 1.5)

═══ SETUP TYPE 2: MOMENTUM BREAKOUT ═══
Wanneer te kopen:
- RSI 45-65 (niet overbought) + MACD bullish (cross of aanhoudend)
- Trend: uptrend of prijsdoorbraak boven EMA20
- Entry: bij huidige prijs of kleine pullback
- Stop: onder EMA20
- Target: gemeten move of volgende weerstand (R/R >= 1.5)

═══ SETUP TYPE 3: BTC LAG PLAY ═══
Wanneer BTC in uptrend staat maar altcoin nog niet bewogen is:
- Buy de achterblijvende altcoin op steunniveau
- Confidence: 0.52-0.58 (lager dan andere setups want indirect)

═══ MARKT BIAS ═══
Fear & Greed < 30 (extreme fear) → VERHOOG confidence met 0.05 voor bounces
Fear & Greed > 70 (greed) → VERLAAG confidence met 0.05, alleen momentum setups
BTC in uptrend → VERHOOG confidence met 0.03 voor alle setups
BTC in downtrend → VERLAAG confidence met 0.05, alleen oversold bounces bij sterke steun

═══ SKIP WANNEER ═══
- RSI > 75 (te overbought voor veilige entry)
- Prijs in vrije val, geen steun in zicht (RSI < 20, dalend volume)
- Duidelijk bearish breaking news (hack, ban, exploit)
- Nul data beschikbaar

═══ CONFIDENCE CALIBRATIE ═══
0.50-0.54: Dunne setup, één criterium, paper trading acceptabel
0.55-0.62: Solide TA setup, twee of meer criteria
0.63-0.72: Sterke convergentie TA + nieuws + markt bias
0.73+: Meerdere harde catalysts + sterke TA

═══ OUTPUT ═══
JSON alleen. Bij buy: stop_loss en take_profit verplicht. R/R minimaal 1.5.
Reden: setup_type + welk niveau + waarom nu."""

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
        for ticker in watchlist:
            if ticker not in ticker_data:
                ticker_data[ticker] = {"news_items": [], "social_posts": [], "news_sentiment_sum": 0, "social_hype_sum": 0, "_watchlist_only": True}

        if crypto_session_mode:
            ticker_data = {ticker: data for ticker, data in ticker_data.items() if is_crypto(ticker)}

        if not ticker_data:
            logger.info("Geen tickers met voldoende data voor signaal generatie")
            return 0

        # Fetch market context once for all signals in this run
        market_ctx = {}
        market_ctx_text = ""
        try:
            market_ctx = await get_market_context()
            market_ctx_text = format_for_prompt(market_ctx)
        except Exception as e:
            logger.debug("Market context ophalen mislukt: %s", e)

        if not self.settings.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY niet geconfigureerd - signaal generatie overgeslagen")
            return 0

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        generated = 0

        limit = 15 if crypto_session_mode else 25
        for asset, data in list(ticker_data.items())[:limit]:
            if is_ai_paused():
                logger.warning("AI analyse tijdens signaalbatch gepauzeerd - resterende assets overgeslagen")
                break
            try:
                if await self._recent_signal_exists(asset):
                    continue

                candles = await self._get_candles(asset)
                candles_4h = await self._get_candles_4h(asset)
                ta_result = ta_analyze(candles) if candles else None
                ta_4h = ta_analyze(candles_4h) if candles_4h else None
                price = candles[-1].close if candles else (candles_4h[-1].close if candles_4h else None)

                # Skip only if we have truly no data at all (no daily, no 4H, no price)
                effective_ta = ta_result or ta_4h
                if data.get("_watchlist_only") and effective_ta is None and not crypto_session_mode:
                    continue
                if data.get("_watchlist_only") and effective_ta is None and price is None:
                    continue

                if self._context_is_stale(data, hours=8, crypto_session_mode=crypto_session_mode, asset=asset, ta_result=ta_result):
                    await self._log_signal_skip(
                        asset,
                        "Context te oud en geen sterke TA voor nieuwe AI-call",
                        {
                            "direction": "skip",
                            "confidence": 0,
                            "reason": "Geen verse nieuws/social katalysator binnen 8 uur en TA-score onvoldoende; AI-call overgeslagen.",
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
                if ta_result or ta_4h:
                    parts = []
                    if ta_result:
                        rsi_str = f"{ta_result.rsi:.0f}" if ta_result.rsi is not None else "N/A"
                        ema_info = ""
                        if ta_result.ema20 and ta_result.pct_from_ema20 is not None:
                            ema_info += f" | EMA20 {ta_result.pct_from_ema20:+.1f}%"
                        if ta_result.ema50 and ta_result.pct_from_ema50 is not None:
                            ema_info += f" | EMA50 {ta_result.pct_from_ema50:+.1f}%"
                        setup_hint = f" [{ta_result.setup_type}]" if ta_result.setup_type != "none" else ""
                        parts.append(
                            f"[1D] Score:{ta_result.score:.2f} | RSI:{rsi_str} | MACD:{ta_result.macd_signal} | {ta_result.trend}{ema_info}{setup_hint} | {ta_result.summary}"
                        )
                    if ta_4h:
                        rsi_4h = f"{ta_4h.rsi:.0f}" if ta_4h.rsi is not None else "N/A"
                        setup_4h = f" [{ta_4h.setup_type}]" if ta_4h.setup_type != "none" else ""
                        parts.append(
                            f"[4H] Score:{ta_4h.score:.2f} | RSI:{rsi_4h} | MACD:{ta_4h.macd_signal} | {ta_4h.trend}{setup_4h}"
                        )
                        # Use 4H TA as fallback if daily has no data
                        if not ta_result:
                            ta_result = ta_4h
                    ta_summary = "\n".join(parts)

                if lessons:
                    ta_summary += f"\n\n🧠 Geheugen {asset}:\n" + "\n".join(f"  {l}" for l in lessons)

                price_str = f"{price:.4f}" if price else "onbekend"

                if is_ai_paused():
                    logger.warning("AI analyse vlak voor signaalcall gepauzeerd - resterende assets overgeslagen")
                    break
                signal_data, resp = self._call_signal_agent(
                    client, asset, price_str, news_summary, social_summary, ta_summary,
                    crypto_session_mode=crypto_session_mode,
                    market_context=market_ctx_text,
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

    def _context_is_stale(self, data: dict, hours: int = 8, crypto_session_mode: bool = False, asset: str | None = None, ta_result=None) -> bool:
        if crypto_session_mode and asset and is_crypto(asset):
            return False
        # TA score range is -1.0 (bearish) to +1.0 (bullish).
        # Watchlist-only assets: proceed if TA shows at least slight bullish bias (>= 0.10).
        # Long-only strategy: no point analyzing neutral/bearish setups without news catalyst.
        if data.get("_watchlist_only"):
            if ta_result is not None and ta_result.score is not None:
                return ta_result.score < 0.10  # stale when score < 0.10; proceed when >= 0.10
            return True  # no TA data at all → skip
        cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)
        timestamps = []
        for item in data.get("news_items", []):
            if item.published_at:
                timestamps.append(item.published_at)
        for item in data.get("social_posts", []):
            if item.posted_at:
                timestamps.append(item.posted_at)
        if not timestamps:
            # No news/social but asset has TA data — allow if TA shows bullish bias
            if ta_result is not None and ta_result.score is not None:
                return ta_result.score < 0.10
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
                            crypto_session_mode: bool = False,
                            market_context: str = "") -> tuple[dict, any]:
        context_block = f"\n\n═══ MARKTCONTEXT ═══\n{market_context}" if market_context else ""
        user_prompt = SIGNAL_USER_PROMPT.format(
            asset=asset,
            price=price,
            news_summary=news_summary,
            social_summary=social_summary,
            ta_summary=ta_summary + context_block,
        )
        system_prompt = CRYPTO_SESSION_SYSTEM_PROMPT if crypto_session_mode and is_crypto(asset) else SIGNAL_SYSTEM_PROMPT
        system_blocks = [{
            "type": "text",
            "text": system_prompt,
            "cache_control": {"type": "ephemeral"},
        }] if self.settings.anthropic_enable_prompt_caching else system_prompt

        response = client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=800,
            temperature=0.5 if crypto_session_mode and is_crypto(asset) else 0.45,
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

    async def _recent_signal_exists(self, asset: str, hours: int = 2) -> bool:
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
        return await svc.get_candles(symbol, "1Day", 60)

    async def _get_candles_4h(self, symbol: str) -> list:
        from app.services.market_data_service import MarketDataService
        svc = MarketDataService()
        return await svc.get_candles(symbol, "4Hour", 60)

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

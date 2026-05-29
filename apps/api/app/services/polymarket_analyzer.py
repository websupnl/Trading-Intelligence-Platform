import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import anthropic
from sqlalchemy import select

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem
from app.models.candles import Candle
from app.services.technical_analysis import analyze as ta_analyze
from app.services.token_tracker import usage_record, flush_usage

logger = logging.getLogger(__name__)

POLYMARKET_SYSTEM_PROMPT = """Je bent een probabiliteitsanalist voor voorspellingsmarkten. Je taak is te bepalen of een Polymarket-markt mis-geprijsd is.

KERNVRAAG: Wat is de werkelijke kans dat dit event plaatsvindt?

AANPAK
1. Analyseer het specifieke event en de exacte conditie (prijs boven/onder X om tijdstip Y)
2. Bekijk recente nieuws en technische data voor het asset
3. Geef een eerlijke kansinschatting gebaseerd op concrete data
4. Bereken de edge: jouw kans minus de marktprijs (= impliciete kans)

WANNEER TRADEN (edge > 10%)
- Markt zegt 40% kans, jij denkt 60%: edge = +20% → koop YES
- Markt zegt 70% kans, jij denkt 45%: edge = -25% → koop NO
- Edge < 10%: te onzeker om te traden

KALIBRATIE
- Crypto prijs events zijn notoir moeilijk te voorspellen over korte perioden
- 5-min events: RSI + momentum zijn dominant
- 1-24u events: nieuws + sentiment + TA + support/resistance
- Wees eerlijk: als je het niet weet, geef dan ~50% (= geen edge)
- Typische range voor edges: 5-30%. Meer dan 40% is uitzonderlijk.

OUTPUT: Alleen geldige JSON, geen uitleg."""

POLYMARKET_USER_PROMPT = """Analyseer deze Polymarket markt:

═══ MARKT ═══
Vraag: {question}
Afloopt: {end_date} ({hours_left}u resterend)
Marktprijs YES: {yes_price:.1%} (= markt denkt {yes_price:.1%} kans op YES)
Marktprijs NO: {no_price:.1%}
Volume: ${volume:,.0f}

═══ NIEUWS (laatste 24u) ═══
{news_summary}

═══ TECHNISCHE ANALYSE ═══
{ta_summary}

Antwoord met dit exacte JSON-schema:
{{
  "yes_probability": <0.00-1.00 — jouw eerlijke schatting dat YES wint>,
  "confidence": <0.50-0.90 — hoe zeker ben je van je schatting>,
  "edge_direction": "yes" | "no" | "skip",
  "edge_size": <0.00-0.50 — abs verschil jouw kans vs marktprijs>,
  "trade_recommended": <true | false>,
  "reasoning": "<concreet: welke data, welke richting, waarom nu, max 80 woorden>",
  "key_catalyst": "<de ene meest bepalende factor, max 25 woorden>",
  "key_risk": "<het grootste risico voor de positie, max 25 woorden>",
  "bull_score": <0.0-1.0>,
  "bear_score": <0.0-1.0>
}}"""


class PolymarketAnalyzer:
    def __init__(self):
        self.settings = get_settings()

    async def analyze_market(self, market: dict[str, Any]) -> dict[str, Any] | None:
        """Run Claude analysis on a Polymarket market. Returns AI analysis dict or None."""
        if not self.settings.anthropic_api_key:
            return None

        question = market.get("question", "")
        yes_price = float(market.get("yes_price") or 0.5)
        no_price = float(market.get("no_price") or 0.5)
        hours_left = market.get("hours_left")
        volume = float(market.get("volume") or 0)
        end_date = market.get("end_date", "")

        # Extract ticker from question if possible
        ticker = self._extract_ticker(question)

        # Get news
        news_summary = await self._get_news_summary(ticker)

        # Get TA if we have a ticker
        ta_summary = await self._get_ta_summary(ticker) if ticker else "Geen TA beschikbaar (geen specifiek asset geïdentificeerd)"

        user_prompt = POLYMARKET_USER_PROMPT.format(
            question=question,
            end_date=end_date,
            hours_left=round(hours_left, 1) if hours_left else "?",
            yes_price=yes_price,
            no_price=no_price,
            volume=volume,
            news_summary=news_summary,
            ta_summary=ta_summary,
        )

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        try:
            response = client.messages.create(
                model=self.settings.anthropic_analysis_model,
                max_tokens=512,
                system=POLYMARKET_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": user_prompt}],
            )
            usage_record(
                model=self.settings.anthropic_analysis_model,
                call_type="polymarket_analysis",
                usage=response.usage,
            )
            await flush_usage()

            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            data = json.loads(raw)

            ai_prob = float(data.get("yes_probability", 0.5))
            market_prob = yes_price
            edge = ai_prob - market_prob
            edge_direction = data.get("edge_direction", "skip")
            trade_recommended = bool(data.get("trade_recommended", False))

            return {
                "yes_probability": round(ai_prob, 4),
                "confidence": float(data.get("confidence", 0.5)),
                "edge_direction": edge_direction,
                "edge_size": round(abs(edge), 4),
                "edge": round(edge, 4),
                "trade_recommended": trade_recommended,
                "reasoning": data.get("reasoning", ""),
                "key_catalyst": data.get("key_catalyst", ""),
                "key_risk": data.get("key_risk", ""),
                "bull_score": float(data.get("bull_score", 0.5)),
                "bear_score": float(data.get("bear_score", 0.5)),
                "ticker": ticker,
                "analyzed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"Polymarket analyse mislukt voor '{question[:50]}': {e}")
            return None

    def _extract_ticker(self, question: str) -> str | None:
        """Extract crypto ticker from market question."""
        q = question.upper()
        tickers = ["BTC", "ETH", "SOL", "DOGE", "AVAX", "BNB", "XRP", "ADA", "LINK", "MATIC"]
        for ticker in tickers:
            if ticker in q or ticker.lower() in question.lower():
                # Exclude partial matches in words
                import re
                if re.search(r'\b' + ticker + r'\b', q):
                    return ticker
        # Check for full names
        name_map = {
            "BITCOIN": "BTC", "ETHEREUM": "ETH", "SOLANA": "SOL",
            "DOGECOIN": "DOGE", "AVALANCHE": "AVAX",
        }
        for name, ticker in name_map.items():
            if name in q:
                return ticker
        return None

    async def _get_news_summary(self, ticker: str | None) -> str:
        """Get recent relevant news from DB."""
        try:
            since = datetime.now(timezone.utc) - timedelta(hours=24)
            async with AsyncSessionLocal() as db:
                query = select(NewsItem).where(
                    NewsItem.ai_analyzed == True,
                    NewsItem.published_at >= since,
                    NewsItem.status != "noise",
                ).order_by(NewsItem.published_at.desc()).limit(20)
                result = await db.execute(query)
                items = result.scalars().all()

            if not items:
                return "Geen recent nieuws beschikbaar."

            # Filter by ticker if we have one
            if ticker:
                relevant = [n for n in items if ticker.lower() in (n.title or "").lower() or ticker.lower() in (n.ai_summary or "").lower()]
                items = relevant[:5] if relevant else items[:3]

            lines = []
            for n in items[:5]:
                sentiment = f"[{n.sentiment}]" if n.sentiment else ""
                lines.append(f"- {n.title} {sentiment}: {(n.ai_summary or '')[:120]}")
            return "\n".join(lines) or "Geen relevant nieuws."
        except Exception:
            return "Nieuws niet beschikbaar."

    async def _get_ta_summary(self, ticker: str) -> str:
        """Get TA summary for ticker from DB candles."""
        try:
            since = datetime.now(timezone.utc) - timedelta(days=5)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(Candle)
                    .where(Candle.symbol == ticker, Candle.timestamp >= since)
                    .order_by(Candle.timestamp.asc())
                    .limit(200)
                )
                candles = result.scalars().all()

            if not candles:
                return f"Geen TA data beschikbaar voor {ticker}."

            ta = ta_analyze([
                {"open": c.open, "high": c.high, "low": c.low, "close": c.close, "volume": c.volume}
                for c in candles
            ])
            price = candles[-1].close
            return (
                f"{ticker} @ ${price:,.2f} | RSI: {ta.get('rsi', 'N/A')} | "
                f"MACD: {ta.get('macd_signal', 'N/A')} | EMA20: {ta.get('ema20', 'N/A')} | "
                f"Vol ratio: {ta.get('volume_ratio', 'N/A')}"
            )
        except Exception as e:
            return f"TA niet beschikbaar voor {ticker}: {e}"

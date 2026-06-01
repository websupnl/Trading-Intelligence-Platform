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
from app.models.candles import Candle
from app.services.technical_analysis import analyze as ta_analyze
from app.services.market_data_service import MarketDataService
from app.gok.strategies import StrategyConfig, get_strategy
from app.gok.risk import calculate_atr, calculate_tp_sl
from app.gok.schemas import OpportunityOut

logger = logging.getLogger(__name__)

GOK_SCAN_PROMPT = """Je bent een speculatieve trading analyst. Analyseer de data en geef een concreet gok-kans oordeel.

Asset: {asset}
Strategie: {strategy_name}
Huidige prijs: {price}

Nieuws (laatste 4u):
{news_summary}

Social media (laatste 4u):
{social_summary}

Technische analyse:
{ta_summary}

Geef ALLEEN JSON terug:
{{
  "should_trade": true | false,
  "confidence": <0.0 tot 1.0>,
  "reason": "<max 120 woorden over WAAROM dit een goede gok is>",
  "key_risk": "<max 40 woorden - het grootste risico>"
}}

Wees realistisch. Geef false als er onvoldoende edge is."""


class GokScanner:
    def __init__(self):
        self.settings = get_settings()
        self.market_data = MarketDataService()

    async def scan(
        self,
        strategy_name: str,
        budget_eur: float = 50.0,
        lookback_hours: int = 4,
    ) -> list[OpportunityOut]:
        """Scan voor kansen die passen bij de gegeven strategie."""
        strategy = get_strategy(strategy_name)
        if not strategy:
            logger.warning(f"Onbekende strategie: {strategy_name}")
            return []

        since = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

        async with AsyncSessionLocal() as db:
            news_result = await db.execute(
                select(NewsItem)
                .where(
                    NewsItem.ai_analyzed == True,
                    NewsItem.published_at >= since,
                    NewsItem.status != "noise",
                    NewsItem.impact_score >= strategy.min_news_impact,
                )
                .order_by(NewsItem.impact_score.desc(), NewsItem.published_at.desc())
                .limit(100)
            )
            news_items = news_result.scalars().all()

            social_result = await db.execute(
                select(SocialPost)
                .where(
                    SocialPost.ai_analyzed == True,
                    SocialPost.posted_at >= since,
                    SocialPost.hype_score >= (strategy.min_hype_score / 100.0),
                )
                .order_by(SocialPost.hype_score.desc())
                .limit(200)
            )
            social_posts = social_result.scalars().all()

        # Aggregeer per ticker
        ticker_data = self._aggregate(news_items, social_posts, strategy)
        if not ticker_data:
            logger.info(f"Geen tickers gevonden voor strategie {strategy_name}")
            return []

        if not self.settings.anthropic_api_key:
            logger.warning("ANTHROPIC_API_KEY niet geconfigureerd")
            return []

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        opportunities = []

        for asset, data in list(ticker_data.items())[:8]:
            try:
                candles = await self.market_data.get_candles(asset, "15Min", 50)
                if not candles:
                    candles = await self.market_data.get_candles(asset, "1Day", 50)

                if not candles:
                    continue

                current_price = candles[-1].close
                ta_result = ta_analyze(candles)

                # TA filter voor relevante strategieën
                if strategy.require_ta and ta_result.score < strategy.min_ta_score:
                    continue

                atr = calculate_atr(candles, period=14)
                if not atr or atr <= 0:
                    # Fallback ATR: 1% van prijs
                    atr = current_price * 0.01

                tp, sl = calculate_tp_sl(current_price, atr, strategy)

                # Vraag Claude om beoordeling
                ai_result = self._call_claude(client, asset, current_price, data, ta_result, strategy)

                if not ai_result.get("should_trade", False):
                    continue

                confidence = float(ai_result.get("confidence", 0))
                if confidence < 0.55:
                    continue

                # Gecombineerde score
                score = self._calculate_score(data, ta_result, strategy, confidence)

                opp = OpportunityOut(
                    asset=asset,
                    strategy=strategy_name,
                    score=round(score, 3),
                    confidence=round(confidence, 3),
                    entry_price=current_price,
                    take_profit=tp,
                    stop_loss=sl,
                    atr=round(atr, 8),
                    reason=ai_result.get("reason", ""),
                    news_score=round(data["news_score"], 3),
                    social_score=round(data["social_score"], 3),
                    ta_score=round(ta_result.score, 3),
                    news_headlines=[n.title[:80] for n in data["news_items"][:3]],
                )
                opportunities.append(opp)

            except Exception as e:
                logger.error(f"Scan fout voor {asset}: {e}")

        # Sorteer op score
        opportunities.sort(key=lambda x: x.score, reverse=True)
        return opportunities

    def _aggregate(self, news_items, social_posts, strategy: StrategyConfig) -> dict:
        data: dict = {}

        for item in news_items:
            for ticker in (item.tickers or []):
                if len(ticker) < 2 or len(ticker) > 10:
                    continue
                if ticker not in data:
                    data[ticker] = {
                        "news_items": [], "social_posts": [],
                        "news_score": 0.0, "social_score": 0.0,
                    }
                data[ticker]["news_items"].append(item)
                impact = float(item.impact_score or 5)
                sentiment = float(item.sentiment_score or 0)
                data[ticker]["news_score"] += (impact / 10.0) * max(0, sentiment)

        for post in social_posts:
            for ticker in (post.tickers or []):
                if len(ticker) < 2 or len(ticker) > 10:
                    continue
                if ticker not in data:
                    data[ticker] = {
                        "news_items": [], "social_posts": [],
                        "news_score": 0.0, "social_score": 0.0,
                    }
                data[ticker]["social_posts"].append(post)
                data[ticker]["social_score"] += float(post.hype_score or 0)

        # Filter op strategie vereisten
        filtered = {}
        for ticker, d in data.items():
            has_news = len(d["news_items"]) >= 1
            has_social = len(d["social_posts"]) >= 2

            if strategy.require_news and not has_news:
                continue
            if strategy.require_social and not has_social:
                continue
            if not has_news and not has_social:
                continue

            filtered[ticker] = d

        # Sorteer op gecombineerde kracht
        return dict(sorted(
            filtered.items(),
            key=lambda x: (
                x[1]["news_score"] * strategy.news_weight +
                x[1]["social_score"] * strategy.social_weight
            ),
            reverse=True,
        ))

    def _call_claude(self, client, asset: str, price: float, data: dict, ta_result, strategy: StrategyConfig) -> dict:
        news_summary = "\n".join([
            f"- [{n.source}] {n.title[:80]} (impact: {n.impact_score:.0f}/10, sentiment: {n.sentiment})"
            for n in data["news_items"][:4]
        ]) or "Geen recent nieuws"

        social_summary = "\n".join([
            f"- hype={p.hype_score:.2f}, score={p.score}: {p.content[:80]}"
            for p in data["social_posts"][:4]
        ]) or "Geen social media data"

        rsi_str = f"{ta_result.rsi:.0f}" if ta_result.rsi is not None else "N/A"
        ta_summary = (
            f"Score: {ta_result.score:.2f} | RSI: {rsi_str} | "
            f"MACD: {ta_result.macd_signal} | Trend: {ta_result.trend} | {ta_result.summary}"
        )

        prompt = GOK_SCAN_PROMPT.format(
            asset=asset,
            strategy_name=strategy.display_name,
            price=f"{price:.4f}" if price < 1 else f"{price:.2f}",
            news_summary=news_summary,
            social_summary=social_summary,
            ta_summary=ta_summary,
        )

        try:
            response = client.messages.create(
                model=self.settings.anthropic_model,
                max_tokens=300,
                messages=[{"role": "user", "content": prompt}],
            )
            text = response.content[0].text.strip()
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
        except Exception as e:
            logger.error(f"Claude scan fout voor {asset}: {e}")

        return {"should_trade": False}

    def _calculate_score(self, data: dict, ta_result, strategy: StrategyConfig, ai_confidence: float) -> float:
        news_component = min(1.0, data["news_score"] / 5.0) * strategy.news_weight
        social_component = min(1.0, data["social_score"] / 3.0) * strategy.social_weight
        ta_component = max(0, ta_result.score) * strategy.ta_weight
        ai_component = ai_confidence * 2.0

        total_weight = strategy.news_weight + strategy.social_weight + strategy.ta_weight + 2.0
        raw = (news_component + social_component + ta_component + ai_component) / total_weight
        return min(1.0, max(0.0, raw))

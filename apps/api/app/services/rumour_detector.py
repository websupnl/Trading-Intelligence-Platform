import json
import logging
from datetime import datetime, timezone, timedelta
import anthropic
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.models.rumours import Rumour

logger = logging.getLogger(__name__)

RUMOUR_PROMPT = """Analyseer of de volgende berichten een handelbare geruchten-situatie vormen.

Asset: {asset}
Nieuwsberichten ({news_count}):
{news_summary}

Social posts ({social_count}):
{social_summary}

Is dit een geruchten-situatie (bijv. overname, partnerschap, product launch, CEO wissel)?
Geef ALLEEN JSON terug:
{{
  "is_rumour": <true of false>,
  "title": "<korte beschrijving max 80 tekens>",
  "description": "<max 200 woorden>",
  "confidence": <0.0 tot 1.0>,
  "manipulation_risk": <0.0 tot 1.0>,
  "hype_velocity": <0.0 tot 1.0, hoe snel groeit dit>,
  "recommendation": "buy" | "sell" | "watch" | "avoid",
  "rumour_type": "acquisition" | "partnership" | "product" | "earnings" | "regulatory" | "executive" | "other"
}}"""


class RumourDetectorService:
    def __init__(self):
        self.settings = get_settings()

    async def detect_rumours(self, lookback_hours: int = 12) -> int:
        """Detect rumours from cross-source patterns. Returns count created."""
        since = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)

        async with AsyncSessionLocal() as db:
            news_result = await db.execute(
                select(NewsItem)
                .where(NewsItem.ai_analyzed == True, NewsItem.published_at >= since,
                       NewsItem.status != "noise")
                .limit(100)
            )
            news_items = news_result.scalars().all()

            social_result = await db.execute(
                select(SocialPost)
                .where(SocialPost.ai_analyzed == True, SocialPost.posted_at >= since,
                       SocialPost.score >= 10)
                .limit(200)
            )
            social_posts = social_result.scalars().all()

        # Group by ticker
        ticker_news: dict[str, list] = {}
        ticker_social: dict[str, list] = {}

        for item in news_items:
            for ticker in (item.tickers or []):
                ticker_news.setdefault(ticker, []).append(item)

        for post in social_posts:
            for ticker in (post.tickers or []):
                ticker_social.setdefault(ticker, []).append(post)

        # Find tickers with cross-source activity
        candidates = set()
        for ticker in ticker_news:
            if len(ticker_news.get(ticker, [])) >= 2:
                candidates.add(ticker)
        for ticker in ticker_social:
            if len(ticker_social.get(ticker, [])) >= 3:
                candidates.add(ticker)

        if not candidates or not self.settings.anthropic_api_key:
            return 0

        client = anthropic.Anthropic(api_key=self.settings.anthropic_api_key)
        created = 0

        for asset in list(candidates)[:5]:  # max 5 rumours per run
            try:
                if await self._rumour_exists(asset):
                    continue

                news = ticker_news.get(asset, [])[:4]
                social = ticker_social.get(asset, [])[:5]

                result = self._analyze_rumour(client, asset, news, social)

                if not result.get("is_rumour"):
                    continue

                await self._save_rumour(asset, result, news, social)
                created += 1
                logger.info(f"Gerucht gedetecteerd: {asset} — {result.get('title')}")

            except Exception as e:
                logger.error(f"Rumour detectie fout {asset}: {e}")

        return created

    def _analyze_rumour(self, client, asset: str, news: list, social: list) -> dict:
        news_summary = "\n".join([f"- {n.title[:80]} ({n.source})" for n in news]) or "Geen nieuws"
        social_summary = "\n".join([f"- r/{p.subreddit} score={p.score}: {p.content[:80]}" for p in social]) or "Geen posts"

        prompt = RUMOUR_PROMPT.format(
            asset=asset,
            news_count=len(news),
            social_count=len(social),
            news_summary=news_summary,
            social_summary=social_summary,
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
        return {"is_rumour": False}

    async def _rumour_exists(self, asset: str) -> bool:
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Rumour).where(
                    Rumour.related_assets.contains([asset]),
                    Rumour.created_at >= since,
                    Rumour.status == "active",
                ).limit(1)
            )
            return result.scalar_one_or_none() is not None

    async def _save_rumour(self, asset: str, data: dict, news: list, social: list):
        expires = datetime.now(timezone.utc) + timedelta(hours=72)
        rumour = Rumour(
            title=data.get("title", f"Gerucht: {asset}")[:500],
            description=data.get("description", ""),
            related_assets=[asset],
            source_news_ids=[n.id for n in news],
            source_post_ids=[p.id for p in social],
            independent_source_count=len(news) + min(len(social), 3),
            confidence=float(data.get("confidence", 0.5)),
            manipulation_risk=float(data.get("manipulation_risk", 0.3)),
            hype_velocity=float(data.get("hype_velocity", 0.3)),
            recommendation=data.get("recommendation", "watch"),
            ai_analysis=data,
            status="active",
            expires_at=expires,
        )
        async with AsyncSessionLocal() as db:
            db.add(rumour)
            await db.commit()

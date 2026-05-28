import json
import logging
import time
from datetime import datetime, timezone
import anthropic
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.services.notifications import NotificationService
from app.services.token_tracker import usage_record, flush_usage

logger = logging.getLogger(__name__)

ANALYSIS_PROMPT = """Analyseer dit nieuwsbericht voor handelsimplicaties. Geef ALLEEN JSON terug, geen uitleg.

Titel: {title}
Bron: {source}
Inhoud: {content}

JSON formaat:
{{
  "sentiment": "bullish" | "bearish" | "neutral",
  "sentiment_score": <getal -1.0 tot 1.0>,
  "impact_score": <getal 0 tot 10>,
  "tickers": [<max 5 aandelensymbolen zoals AAPL, NVDA>],
  "trading_implication": "<max 80 woorden>",
  "urgency": "high" | "medium" | "low",
  "is_noise": <true of false>,
  "event_type": "earnings" | "merger" | "regulatory" | "macro" | "product" | "social" | "other"
}}"""

SOCIAL_PROMPT = """Analyseer dit Reddit bericht voor handelssignalen. Geef ALLEEN JSON terug.

Subreddit: r/{subreddit}
Auteur: {author} | Score: {score} | Comments: {comments}
Inhoud: {content}

JSON formaat:
{{
  "sentiment": "bullish" | "bearish" | "neutral",
  "sentiment_score": <getal -1.0 tot 1.0>,
  "hype_score": <getal 0.0 tot 1.0>,
  "tickers": [<max 5 aandelensymbolen>],
  "is_dd": <true als dit Due Diligence/research is, false als hype>,
  "is_noise": <true of false>,
  "manipulation_risk": <getal 0.0 tot 1.0>
}}"""


class NewsAnalyzerService:
    def __init__(self):
        self.settings = get_settings()

    def _get_client(self):
        if not self.settings.anthropic_api_key:
            raise ValueError("ANTHROPIC_API_KEY niet geconfigureerd")
        return anthropic.Anthropic(api_key=self.settings.anthropic_api_key)

    @property
    def _analysis_model(self) -> str:
        return self.settings.anthropic_analysis_model

    async def analyze_pending_news(self, batch_size: int = 20) -> int:
        """Analyze unanalyzed news items. Returns count analyzed."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem)
                .where(NewsItem.ai_analyzed == False, NewsItem.status == "new")
                .order_by(NewsItem.published_at.desc())
                .limit(batch_size)
            )
            items = result.scalars().all()

        if not items:
            return 0

        client = self._get_client()
        analyzed = 0

        for item in items:
            try:
                analysis, resp = self._analyze_news_item(client, item)

                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(NewsItem).where(NewsItem.id == item.id))
                    db_item = result.scalar_one_or_none()
                    if db_item:
                        db_item.sentiment = analysis.get("sentiment", "neutral")
                        db_item.sentiment_score = float(analysis.get("sentiment_score", 0))
                        db_item.impact_score = float(analysis.get("impact_score", 5))
                        # Merge new tickers with existing
                        existing = db_item.tickers or []
                        new_tickers = analysis.get("tickers", [])
                        db_item.tickers = list(set(existing + new_tickers))[:10]
                        db_item.ai_analyzed = True
                        db_item.ai_analysis = analysis
                        if analysis.get("is_noise"):
                            db_item.status = "noise"
                        await flush_usage(db, [usage_record(self.settings.anthropic_model, "news_analysis", resp.usage)])
                        await db.commit()
                        if (
                            not analysis.get("is_noise")
                            and float(analysis.get("impact_score", 0)) >= 8
                            and analysis.get("urgency") == "high"
                        ):
                            tickers = ", ".join(db_item.tickers or []) or "geen ticker"
                            await NotificationService(db).send(
                                "high_impact_news",
                                f"Trading OS - Hoog-impact nieuws: {tickers}",
                                f"{db_item.source}: {db_item.title[:300]}",
                                severity="warning",
                                entity_type="news",
                                entity_id=db_item.id,
                            )

                analyzed += 1
                # Rate limit: ~40 req/min for claude-haiku is fine, but be conservative
                time.sleep(0.1)

            except Exception as e:
                logger.warning(f"News analyse fout voor {item.id}: {e}")
                # Mark as analyzed with error to avoid infinite retries
                # Mark as analyzed with error to avoid infinite retries
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(NewsItem).where(NewsItem.id == item.id))
                    db_item = result.scalar_one_or_none()
                    if db_item:
                        db_item.ai_analyzed = True
                        db_item.status = "analysis_error"
                        await db.commit()

        logger.info(f"News analyse: {analyzed}/{len(items)} items verwerkt")
        return analyzed

    def _analyze_news_item(self, client, item: NewsItem) -> tuple[dict, any]:
        content = (item.content or item.title)[:800]
        prompt = ANALYSIS_PROMPT.format(
            title=item.title,
            source=item.source,
            content=content,
        )
        response = client.messages.create(
            model=self._analysis_model,
            max_tokens=256,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Extract JSON even if there's surrounding text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end]), response
        return ({"sentiment": "neutral", "sentiment_score": 0, "impact_score": 5,
                "tickers": [], "is_noise": False, "urgency": "low", "event_type": "other"}, response)

    async def analyze_pending_social(self, batch_size: int = 30) -> int:
        """Analyze unanalyzed social posts."""
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(SocialPost)
                .where(SocialPost.ai_analyzed == False)
                .order_by(SocialPost.posted_at.desc())
                .limit(batch_size)
            )
            items = result.scalars().all()

        if not items:
            return 0

        client = self._get_client()
        analyzed = 0

        for item in items:
            try:
                analysis, resp = self._analyze_social_item(client, item)

                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(SocialPost).where(SocialPost.id == item.id))
                    db_item = result.scalar_one_or_none()
                    if db_item:
                        db_item.sentiment = analysis.get("sentiment", "neutral")
                        db_item.sentiment_score = float(analysis.get("sentiment_score", 0))
                        db_item.hype_score = float(analysis.get("hype_score", 0))
                        existing = db_item.tickers or []
                        new_tickers = analysis.get("tickers", [])
                        db_item.tickers = list(set(existing + new_tickers))[:10]
                        db_item.ai_analyzed = True
                        db_item.ai_analysis = analysis
                        await flush_usage(db, [usage_record(self.settings.anthropic_model, "social_analysis", resp.usage)])
                        await db.commit()

                analyzed += 1
                time.sleep(0.05)

            except Exception as e:
                logger.warning(f"Social analyse fout {item.id}: {e}")
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(SocialPost).where(SocialPost.id == item.id))
                    db_item = result.scalar_one_or_none()
                    if db_item:
                        db_item.ai_analyzed = True
                        await db.commit()

        return analyzed

    def _analyze_social_item(self, client, item: SocialPost) -> tuple[dict, any]:
        prompt = SOCIAL_PROMPT.format(
            subreddit=item.subreddit or "unknown",
            author=item.author or "unknown",
            score=item.score or 0,
            comments=item.num_comments or 0,
            content=item.content[:600],
        )
        response = client.messages.create(
            model=self._analysis_model,
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end]), response
        return ({"sentiment": "neutral", "sentiment_score": 0, "hype_score": 0.3,
                "tickers": [], "is_dd": False, "is_noise": True, "manipulation_risk": 0.5}, response)

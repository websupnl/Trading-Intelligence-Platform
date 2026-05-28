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
from app.services.ai_guard import is_ai_paused, is_ai_failure, pause_ai

logger = logging.getLogger(__name__)

RUMOUR_SYSTEM_PROMPT = """Je bent een rumour-detection analist voor een trading systeem. Je classificeert of er een handelbare gerucht-situatie speelt.

WAT IS EEN RUMOUR (echte definitie)
- Concreet, nog niet bevestigd event dat de prijs zou bewegen ALS waar: overname, partnerschap, product launch, CEO wissel, regulatory action.
- Multi-bron clustering: één post of artikel is GEEN rumour. Je hebt convergentie nodig.
- Specifieke partijen genoemd: "X mogelijk overgenomen door Y" niet "Stock could be a takeover target".

WAT IS GEEN RUMOUR (is_rumour=false)
- Algemene speculatie/wishful thinking
- Analyst price targets (= mening, geen rumour)
- Bevestigd nieuws (al openbaar, geen edge)
- Memes/jokes/satire
- Pump-coördinatie zonder substantie
- Vaag "something is brewing" zonder concrete claim

CONFIDENCE (hoe waarschijnlijk is het rumour-event echt?)
- 0.3-0.4: één bron, niet verifieerbaar, kan pump zijn
- 0.5-0.6: meerdere bronnen, plausibele bron-credibiliteit
- 0.7-0.8: industriepublicatie + onafhankelijke confirmatie, named parties
- 0.9+: insider leak met track record, gestaafde details

HYPE_VELOCITY (groeisnelheid)
- Hoeveel bronnen pakken dit binnen 24u op?
- Stijgende social mention rate = hoog
- Static of dalend = laag

MANIPULATION_RISK
- Verhoog bij: laag-volume stock, anonieme bron, coordinated social push, lage-credibiliteit publicatie als single source
- 0.7+ = waarschijnlijk pump, avoid

RECOMMENDATION
- buy: hoge confidence (>0.65) + lage manipulation risk (<0.4) + asset niet al gestegen
- watch: middelhoge confidence, wachten op confirmatie
- avoid: hoge manipulation risk OF al ingeprijsd
- sell: NIET TOEGESTAAN — long-only systeem, gebruik avoid

Geef ALLEEN geldig JSON. Geen prose."""


RUMOUR_PROMPT = """Beoordeel of de volgende berichten een handelbare rumour-situatie vormen.

Asset: {asset}

═══ NIEUWSBERICHTEN ({news_count}) ═══
{news_summary}

═══ SOCIAL POSTS ({social_count}) ═══
{social_summary}

Vragen om te beantwoorden:
1. Wordt er een CONCRETE, ongepubliceerde event-claim gemaakt (overname, partnerschap, etc.)?
2. Convergeren meerdere onafhankelijke bronnen op dezelfde claim?
3. Is het al ingeprijsd? (check tegen al-bekend nieuws)
4. Wat is de manipulation risk?

JSON formaat:
{{
  "is_rumour": <true alleen bij concrete event-claim met multi-bron convergentie>,
  "title": "<concreet event in max 80 tekens, bv 'X overweegt overname Y'>",
  "description": "<wat, wie, bron-kwaliteit, tijdlijn — max 150 woorden>",
  "confidence": <0.0-1.0 volgens rubric>,
  "manipulation_risk": <0.0-1.0>,
  "hype_velocity": <0.0-1.0, mention-groeisnelheid>,
  "already_priced_in": <true | false>,
  "source_quality": "low" | "medium" | "high",
  "recommendation": "buy" | "watch" | "avoid",
  "rumour_type": "acquisition" | "partnership" | "product" | "earnings" | "regulatory" | "executive" | "other"
}}"""


class RumourDetectorService:
    def __init__(self):
        self.settings = get_settings()

    async def detect_rumours(self, lookback_hours: int = 12) -> int:
        """Detect rumours from cross-source patterns. Returns count created."""
        if is_ai_paused():
            logger.warning("AI analyse gepauzeerd - geruchtendetectie overgeslagen")
            return 0

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
                if is_ai_failure(e):
                    await pause_ai("rumour_detector", e)
                    break

        return created

    def _analyze_rumour(self, client, asset: str, news: list, social: list) -> dict:
        news_summary = "\n".join([f"- {n.title[:80]} ({n.source})" for n in news]) or "Geen nieuws"
        social_summary = "\n".join([f"- r/{p.subreddit} score={p.score}: {p.content[:80]}" for p in social]) or "Geen posts"

        user_prompt = RUMOUR_PROMPT.format(
            asset=asset,
            news_count=len(news),
            social_count=len(social),
            news_summary=news_summary,
            social_summary=social_summary,
        )
        system_blocks = (
            [{"type": "text", "text": RUMOUR_SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
            if self.settings.anthropic_enable_prompt_caching else RUMOUR_SYSTEM_PROMPT
        )
        response = client.messages.create(
            model=self.settings.anthropic_model,
            max_tokens=700,
            temperature=0.2,
            system=system_blocks,
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end])
        return {"is_rumour": False}

    async def _rumour_exists(self, asset: str) -> bool:
        from sqlalchemy import cast, func
        from sqlalchemy.dialects.postgresql import JSONB
        since = datetime.now(timezone.utc) - timedelta(hours=24)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Rumour).where(
                    cast(Rumour.related_assets, JSONB).contains([asset]),
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

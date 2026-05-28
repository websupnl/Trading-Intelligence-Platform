import json
import logging
import time
from datetime import datetime, timezone, timedelta
import anthropic
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.services.notifications import NotificationService
from app.services.token_tracker import usage_record, flush_usage
from app.services.ai_guard import is_ai_paused, is_ai_failure, pause_ai

logger = logging.getLogger(__name__)

ANALYSIS_SYSTEM_PROMPT = """Je bent een nieuwsanalist voor een trading systeem. Je taak is harde signaal-van-ruis filtering.

KERNREGEL: de meeste headlines zijn AL INGEPRIJSD of NIET ACTIONABLE. Default classificatie is is_noise=true tenzij bewezen anders.

IMPACT SCORE RUBRIC (strikt — geen tussenwaarden uitvinden)
- 0-2: Filler, recap, opinion piece, herhalend nieuws. is_noise=true.
- 3-4: Achtergrond/context, niet handelsbeslissend op zich.
- 5-6: Relevant nieuws, beweegt sentiment, niet noodzakelijk de prijs op korte termijn.
- 7-8: Concrete katalysator (earnings beat/miss, FDA approval, contract, downgrade van top-tier bank). Reden voor positie-aanpassing.
- 9-10: Major event (overname, faillissement, beurscrash, oorlog, halt). Zeldzaam — gebruik <5% van de tijd.

TICKER EXTRACTIE
- Alleen tickers waar het nieuws DIRECT impact op heeft, niet alleen vermelding.
- "Apple supplier X" → AAPL alleen als impact significant, anders skip.
- Max 5 echt geraakte tickers.
- Geen ticker-jacht: "tech stocks daalden" zonder specifieke namen → lege array.

NOISE DETECTIE (is_noise=true bij ÉÉN van deze)
- Headline is een herhaling/recap van events ouder dan 48u
- Pure opinion zonder nieuwe feiten ("analyst thinks X")
- Clickbait zonder substance
- Crypto-pump artikel zonder fundamentele basis
- Recap van eerdere prijsbeweging ("X jumped 5% today" zonder oorzaak)
- Sponsored content of advertorial

URGENCY
- high: actie binnen 24u relevant (earnings vandaag, breaking event)
- medium: binnen de week relevant
- low: thematisch, lange-termijn context

SENTIMENT
- Score op CONCRETE PRIJSIMPACT, niet op tone-of-voice.
- "Stock crashed" met reden = bearish (-0.7 tot -0.9)
- "Stock crashed" als beschrijving van al gebeurd = neutraal/al ingeprijsd
- Bull/bear framing in titel ≠ je sentiment-judgement.

Geef ALLEEN geldig JSON terug. Geen uitleg vooraf of achteraf."""


ANALYSIS_PROMPT = """Klassificeer dit nieuwsbericht.

Titel: {title}
Bron: {source}
Inhoud: {content}

Vragen om mentaal te beantwoorden:
1. Is dit ECHT nieuw, of recap van bekende informatie?
2. Heeft dit een concrete, dateerbare impact op een specifieke prijs?
3. Of is dit sentiment-only context zonder actionable edge?

JSON formaat:
{{
  "sentiment": "bullish" | "bearish" | "neutral",
  "sentiment_score": <-1.0 tot 1.0 — score op verwachte prijsimpact, niet op toon>,
  "impact_score": <0-10 volgens rubric>,
  "tickers": [<alleen direct getroffen tickers, max 5; lege array als geen specifiek>],
  "trading_implication": "<concrete actie of skip-reden, max 60 woorden>",
  "urgency": "high" | "medium" | "low",
  "is_noise": <true is default — false alleen bij concrete nieuwe info>,
  "is_already_priced_in": <true als dit nieuws breed bekend is/was>,
  "event_type": "earnings" | "merger" | "regulatory" | "macro" | "product" | "social" | "other"
}}"""


SOCIAL_SYSTEM_PROMPT = """Je analyseert social media posts (Reddit) voor trading signaal-extractie. Je bent zeer kritisch: social hype is meestal een contra-indicator, geen signaal.

DEFAULT MINDSET
- is_noise=true tenzij bewezen anders. Verwacht is_noise>=70% van posts.
- Hype zonder substance = manipulation_risk hoog.
- Een ticker noemen ≠ trading signal. Mention-zonder-onderbouwing = noise.

HYPE_SCORE (0.0-1.0)
- 0.0-0.2: Discussie/context, geen actieve hype
- 0.3-0.5: Bullish framing, enige urgentie ("about to moon", "load up")
- 0.6-0.8: Sterke FOMO-taal, urgentie ("last chance", "10x incoming")
- 0.9-1.0: Pure pump/coordinated push (rocket emoji spam, "WSB squad", penny stock raves)

IS_DD vs IS_HYPE
- is_dd=true alleen bij: concrete cijfers, citaten van filings, multi-paragraaf analyse, geen pump-taal, auteur toont expertise.
- is_dd=false bij: meme posts, één-zin "calls", screenshot-only, hype-taal.

MANIPULATION_RISK (0.0-1.0)
- Verhoog bij: lage-float micro-cap mention, coordinated language patterns, urgency taal, "do your own research" als excuus, account-leeftijd niet verifieerbaar, copy-paste karakteristieken.
- 0.7+ = pump risico, behandel als niet-bestaand signaal.
- 0.4-0.7 = behoedzaam — kan organic enthusiasm zijn maar verifieer
- <0.4 = waarschijnlijk legitieme discussie

TICKER EXTRACTIE
- Alleen tickers waar de post over GAAT, niet elke mention.
- "I sold X to buy Y" → alleen Y als de discussie over Y gaat.

SENTIMENT moet onafhankelijk van hype zijn — een pump-post is bullish-sentiment + hoge manipulation_risk.

Geef ALLEEN geldig JSON. Geen uitleg eromheen."""


SOCIAL_PROMPT = """Klassificeer deze post.

Subreddit: r/{subreddit}
Auteur: {author} | Score: {score} | Comments: {comments}
Inhoud: {content}

JSON formaat:
{{
  "sentiment": "bullish" | "bearish" | "neutral",
  "sentiment_score": <-1.0 tot 1.0>,
  "hype_score": <0.0-1.0 volgens rubric>,
  "tickers": [<alleen primaire onderwerp tickers, max 5>],
  "is_dd": <true alleen bij echte due diligence>,
  "is_noise": <default true; false alleen bij genuine analyse of breaking info>,
  "manipulation_risk": <0.0-1.0 volgens rubric>,
  "signal_quality": "actionable" | "watchlist" | "noise"
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

    async def _mark_stale_news(self, older_than: datetime) -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem).where(
                    NewsItem.status == "new",
                    NewsItem.published_at < older_than,
                ).limit(100)
            )
            items = result.scalars().all()
            for item in items:
                item.ai_analyzed = True
                item.status = "stale"
                item.ai_analysis = {"skipped": True, "reason": "Artikel te oud voor trading-context"}
            if items:
                await db.commit()
            return len(items)

    async def _mark_stale_social(self, older_than: datetime) -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(SocialPost).where(
                    SocialPost.ai_analyzed == False,
                    SocialPost.posted_at < older_than,
                ).limit(100)
            )
            items = result.scalars().all()
            for item in items:
                item.ai_analyzed = True
                item.ai_analysis = {"skipped": True, "reason": "Post te oud voor trading-context"}
            if items:
                await db.commit()
            return len(items)

    async def analyze_pending_news(self, batch_size: int = 20) -> int:
        """Analyze unanalyzed news items. Returns count analyzed."""
        fresh_after = datetime.now(timezone.utc) - timedelta(hours=36)
        stale_count = await self._mark_stale_news(fresh_after)
        if stale_count:
            logger.info("News analyse: %s oude items zonder AI gemarkeerd als stale", stale_count)

        if is_ai_paused():
            logger.warning("AI analyse gepauzeerd - news analyse overgeslagen na stale cleanup")
            return 0

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(NewsItem)
                .where(
                    NewsItem.ai_analyzed == False,
                    NewsItem.status == "new",
                    NewsItem.published_at >= fresh_after,
                )
                .order_by(NewsItem.published_at.desc())
                .limit(batch_size)
            )
            items = result.scalars().all()

        if not items:
            return 0

        client = self._get_client()
        analyzed = 0

        for item in items:
            if is_ai_paused():
                logger.warning("AI analyse tijdens news batch gepauzeerd - resterende items overgeslagen")
                break
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
                if is_ai_failure(e):
                    await pause_ai("news_analyzer", e)
                    break
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

    def _system_blocks(self, system_text: str):
        """Build cacheable system prompt block when caching is enabled."""
        if self.settings.anthropic_enable_prompt_caching:
            return [{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}]
        return system_text

    def _analyze_news_item(self, client, item: NewsItem) -> tuple[dict, any]:
        content = (item.content or item.title)[:800]
        user_prompt = ANALYSIS_PROMPT.format(
            title=item.title,
            source=item.source,
            content=content,
        )
        response = client.messages.create(
            model=self._analysis_model,
            max_tokens=350,
            temperature=0.2,
            system=self._system_blocks(ANALYSIS_SYSTEM_PROMPT),
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text.strip()
        # Extract JSON even if there's surrounding text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end]), response
        return ({"sentiment": "neutral", "sentiment_score": 0, "impact_score": 5,
                "tickers": [], "is_noise": True, "urgency": "low", "event_type": "other"}, response)

    async def analyze_pending_social(self, batch_size: int = 30) -> int:
        """Analyze unanalyzed social posts."""
        fresh_after = datetime.now(timezone.utc) - timedelta(hours=36)
        stale_count = await self._mark_stale_social(fresh_after)
        if stale_count:
            logger.info("Social analyse: %s oude posts zonder AI gemarkeerd als stale", stale_count)

        if is_ai_paused():
            logger.warning("AI analyse gepauzeerd - social analyse overgeslagen na stale cleanup")
            return 0

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(SocialPost)
                .where(SocialPost.ai_analyzed == False, SocialPost.posted_at >= fresh_after)
                .order_by(SocialPost.posted_at.desc())
                .limit(batch_size)
            )
            items = result.scalars().all()

        if not items:
            return 0

        client = self._get_client()
        analyzed = 0

        for item in items:
            if is_ai_paused():
                logger.warning("AI analyse tijdens social batch gepauzeerd - resterende items overgeslagen")
                break
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
                if is_ai_failure(e):
                    await pause_ai("news_analyzer.social", e)
                    break
                async with AsyncSessionLocal() as db:
                    result = await db.execute(select(SocialPost).where(SocialPost.id == item.id))
                    db_item = result.scalar_one_or_none()
                    if db_item:
                        db_item.ai_analyzed = True
                        await db.commit()

        return analyzed

    def _analyze_social_item(self, client, item: SocialPost) -> tuple[dict, any]:
        user_prompt = SOCIAL_PROMPT.format(
            subreddit=item.subreddit or "unknown",
            author=item.author or "unknown",
            score=item.score or 0,
            comments=item.num_comments or 0,
            content=item.content[:600],
        )
        response = client.messages.create(
            model=self._analysis_model,
            max_tokens=250,
            temperature=0.2,
            system=self._system_blocks(SOCIAL_SYSTEM_PROMPT),
            messages=[{"role": "user", "content": user_prompt}],
        )
        text = response.content[0].text.strip()
        start = text.find("{")
        end = text.rfind("}") + 1
        if start >= 0 and end > start:
            return json.loads(text[start:end]), response
        return ({"sentiment": "neutral", "sentiment_score": 0, "hype_score": 0.3,
                "tickers": [], "is_dd": False, "is_noise": True, "manipulation_risk": 0.5}, response)

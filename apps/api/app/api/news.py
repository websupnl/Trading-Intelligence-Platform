from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.news import NewsItem
from app.services.rss_service import RSSFeedService

router = APIRouter(prefix="/api/news")


@router.get("")
async def get_news(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NewsItem).order_by(desc(NewsItem.created_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "title": i.title, "source": i.source, "url": i.url,
             "tickers": i.tickers, "sentiment": i.sentiment, "impact_score": i.impact_score,
             "published_at": i.published_at, "ai_analyzed": i.ai_analyzed, "status": i.status}
            for i in items]


@router.post("/ingest")
async def ingest_news(db: AsyncSession = Depends(get_db)):
    svc = RSSFeedService()
    try:
        count = await svc.ingest_all()
        return {"status": "ok", "ingested": count}
    except Exception as e:
        return {"status": "error", "message": str(e)}


@router.post("/trigger-pipeline")
async def trigger_pipeline():
    """Manually trigger the full analysis pipeline."""
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.tasks.news_tasks.ingest_news")
    celery_app.send_task("app.tasks.social_tasks.fetch_reddit")
    celery_app.send_task("app.tasks.analysis_tasks.analyze_news")
    celery_app.send_task("app.tasks.analysis_tasks.detect_rumours")
    celery_app.send_task("app.tasks.signal_tasks.generate_signals")
    return {"status": "ok", "message": "Pipeline getriggerd — data verschijnt binnen 2-5 minuten"}

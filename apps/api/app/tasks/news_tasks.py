import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.news_tasks.ingest_news")
def ingest_news():
    logger.info("Nieuws ingestie gestart (async task)")
    # Imports here to avoid circular imports
    import asyncio
    from app.services.rss_service import RSSFeedService
    try:
        svc = RSSFeedService()
        count = asyncio.run(svc.ingest_all())
        logger.info(f"Nieuws ingestie klaar: {count} items")
        return {"status": "ok", "count": count}
    except Exception as e:
        logger.error(f"Nieuws ingestie fout: {e}")
        return {"status": "error", "message": str(e)}

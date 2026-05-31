import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.news_tasks.ingest_news")
def ingest_news():
    logger.info("Nieuws ingestie gestart (async task)")
    import asyncio
    from app.services.rss_service import RSSFeedService
    try:
        svc = RSSFeedService()
        count = asyncio.run(svc.ingest_all())
        logger.info(f"Nieuws ingestie klaar: {count} items")
        # Event-driven: trigger signal generation immediately when impactful news arrives
        # instead of waiting up to 10 minutes for the scheduled cycle
        if count > 0:
            celery_app.send_task("app.tasks.analysis_tasks.analyze_news")
            celery_app.send_task("app.tasks.signal_tasks.generate_signals")
            logger.info(f"Signal generatie getriggerd door {count} nieuw(s)item(s)")
        return {"status": "ok", "count": count}
    except Exception as e:
        logger.error(f"Nieuws ingestie fout: {e}")
        return {"status": "error", "message": str(e)}

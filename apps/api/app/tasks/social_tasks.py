import logging
from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.social_tasks.fetch_reddit")
def fetch_reddit():
    import asyncio
    from app.services.reddit_service import RedditScraperService
    try:
        svc = RedditScraperService()
        count = asyncio.run(svc.fetch_all())
        logger.info(f"Reddit scrape klaar: {count} posts")
        return {"status": "ok", "count": count}
    except Exception as e:
        logger.error(f"Reddit scrape fout: {e}")
        return {"status": "error", "message": str(e)}


@celery_app.task(name="app.tasks.social_tasks.fetch_x")
def fetch_x():
    """Fetch high-engagement X/Twitter posts about watchlist assets. Elke 30 minuten."""
    import asyncio
    from app.services.x_monitor_service import XMonitorService
    svc = XMonitorService()
    if not svc.configured:
        return {"status": "skipped", "reason": "X_BEARER_TOKEN niet ingesteld"}
    try:
        count = asyncio.run(svc.fetch_all())
        logger.info(f"X monitor klaar: {count} tweets")
        return {"status": "ok", "count": count}
    except Exception as e:
        logger.error(f"X monitor fout: {e}")
        return {"status": "error", "message": str(e)}

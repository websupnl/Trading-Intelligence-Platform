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
        # Event-driven: trigger signal generation when impactful news arrives,
        # but at most once per 15 minutes to avoid burning tokens on every ingest cycle.
        if count > 0:
            import redis as _redis
            _COOLDOWN_KEY = "trading_os:news_signal_trigger_cooldown"
            try:
                _r = _redis.Redis.from_url(__import__("app.config", fromlist=["get_settings"]).get_settings().redis_url, socket_connect_timeout=0.3, socket_timeout=0.3)
                if not _r.exists(_COOLDOWN_KEY):
                    _r.set(_COOLDOWN_KEY, "1", ex=900)  # 15-minute cooldown
                    celery_app.send_task("app.tasks.analysis_tasks.analyze_news")
                    celery_app.send_task("app.tasks.signal_tasks.generate_signals")
                    logger.info(f"Signal generatie getriggerd door {count} nieuw(s)item(s)")
                else:
                    logger.debug("Signal trigger overgeslagen — cooldown actief (15min)")
            except Exception as _e:
                logger.debug(f"Nieuws trigger cooldown check mislukt: {_e}")
        return {"status": "ok", "count": count}
    except Exception as e:
        logger.error(f"Nieuws ingestie fout: {e}")
        return {"status": "error", "message": str(e)}

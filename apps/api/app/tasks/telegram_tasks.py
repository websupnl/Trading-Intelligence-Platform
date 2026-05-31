import asyncio
import logging

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.telegram_tasks.poll_telegram")
def poll_telegram():
    """Poll Telegram getUpdates en verwerk inkomende bot commands. Elke 3 seconden."""
    from app.config import get_settings
    if not get_settings().telegram_configured:
        return {"status": "skipped", "reason": "not_configured"}

    from app.services.telegram_bot import TelegramBotService

    async def _run():
        return await TelegramBotService().poll_and_dispatch()

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error("Telegram polling fout: %s", exc)
        return {"status": "error", "message": str(exc)}


@celery_app.task(name="app.tasks.telegram_tasks.monitor_telegram_channels")
def monitor_telegram_channels():
    """Scrape configured public Telegram channels for market signals. Elke 30 minuten."""
    from app.config import get_settings
    settings = get_settings()
    if not settings.telegram_monitor_channel_list:
        return {"status": "skipped", "reason": "no_channels_configured"}

    from app.services.telegram_monitor_service import TelegramMonitorService
    import redis as _redis

    async def _run():
        svc = TelegramMonitorService()
        count = await svc.monitor_all()
        return count

    try:
        count = asyncio.run(_run())
        # Event-driven: trigger signal generation when new channel content arrives
        if count and count > 0:
            _COOLDOWN_KEY = "trading_os:tg_monitor_signal_trigger_cooldown"
            try:
                _r = _redis.Redis.from_url(settings.redis_url, socket_connect_timeout=0.3, socket_timeout=0.3)
                if not _r.exists(_COOLDOWN_KEY):
                    _r.set(_COOLDOWN_KEY, "1", ex=600)  # 10-minute cooldown
                    celery_app.send_task("app.tasks.analysis_tasks.analyze_news")
                    celery_app.send_task("app.tasks.signal_tasks.generate_signals")
                    logger.info(f"Signal generatie getriggerd door {count} Telegram item(s)")
            except Exception as _e:
                logger.debug(f"Telegram monitor trigger fout: {_e}")
        return {"status": "ok", "count": count}
    except Exception as exc:
        logger.error("Telegram channel monitoring fout: %s", exc)
        return {"status": "error", "message": str(exc)}

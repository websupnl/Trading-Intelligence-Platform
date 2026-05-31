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
    if not get_settings().telegram_monitor_channel_list:
        return {"status": "skipped", "reason": "no_channels_configured"}

    from app.services.telegram_monitor_service import TelegramMonitorService

    async def _run():
        svc = TelegramMonitorService()
        count = await svc.monitor_all()
        return {"status": "ok", "count": count}

    try:
        return asyncio.run(_run())
    except Exception as exc:
        logger.error("Telegram channel monitoring fout: %s", exc)
        return {"status": "error", "message": str(exc)}

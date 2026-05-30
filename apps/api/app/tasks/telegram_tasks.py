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

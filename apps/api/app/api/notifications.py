from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.notifications import Notification
from app.services.notifications import NotificationService
from app.services.runtime_state import get_runtime_value

router = APIRouter(prefix="/api/notifications")


@router.get("/status")
async def get_notification_status():
    settings = get_settings()
    return {
        "telegram_configured": settings.telegram_configured,
        "channel": "telegram",
    }


@router.get("")
async def get_notifications(limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Notification).order_by(desc(Notification.created_at)).limit(limit))
    return [
        {
            "id": item.id,
            "event_type": item.event_type,
            "channel": item.channel,
            "title": item.title,
            "message": item.message,
            "severity": item.severity,
            "status": item.status,
            "entity_type": item.entity_type,
            "entity_id": item.entity_id,
            "error_message": item.error_message,
            "sent_at": item.sent_at,
            "created_at": item.created_at,
        }
        for item in result.scalars().all()
    ]


@router.post("/test")
async def send_test_notification(db: AsyncSession = Depends(get_db)):
    notification = await NotificationService(db).send(
        "telegram_test",
        "Trading OS - Telegram test",
        "Telegram is gekoppeld. Alerts voor veiligheid, signalen, orders en outcomes kunnen hier verschijnen.",
    )
    return {
        "status": notification.status,
        "message": "Testnotificatie verstuurd." if notification.status == "sent" else notification.error_message,
    }


@router.post("/register-commands")
async def register_telegram_commands():
    """Herregistreer de bot commando-lijst bij BotFather (setMyCommands)."""
    settings = get_settings()
    if not settings.telegram_configured:
        return {"status": "disabled", "message": "Telegram niet geconfigureerd"}
    from app.services.telegram_bot import TelegramBotService
    ok = await TelegramBotService().set_my_commands()
    return {"status": "ok" if ok else "failed"}


@router.get("/bot-info")
async def get_bot_info():
    """Geeft de huidige bot polling status en offset terug."""
    settings = get_settings()
    return {
        "telegram_configured": settings.telegram_configured,
        "current_offset": get_runtime_value("telegram_update_offset", 0),
        "polling_lock": get_runtime_value("telegram_polling_lock", None),
    }

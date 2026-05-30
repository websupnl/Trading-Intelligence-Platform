import logging
from datetime import datetime, timezone

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.notifications import Notification

logger = logging.getLogger(__name__)

TELEGRAM_EVENT_TYPES = {
    "ai_provider_paused", "ai_provider_resumed",
    "auto_trade_executed", "auto_trade_broker_error",
    "position_closed", "position_close_failed",
    "order_submitted", "order_failed",
    "trade_reflection_written", "daily_summary", "trade_summary",
    "circuit_breaker_triggered", "telegram_test",
}

class NotificationService:
    """Persist alerts and optionally deliver them through Telegram."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.settings = get_settings()

    async def send(
        self,
        event_type: str,
        title: str,
        message: str,
        *,
        severity: str = "info",
        entity_type: str | None = None,
        entity_id: str | None = None,
        reply_markup: dict | None = None,
    ) -> Notification:
        notification = Notification(
            event_type=event_type,
            title=title[:255],
            message=message[:4000],
            severity=severity,
            entity_type=entity_type,
            entity_id=entity_id,
            status="pending",
        )
        self.db.add(notification)

        should_send_telegram = (
            event_type in TELEGRAM_EVENT_TYPES
            or severity in {"error", "critical"}
        )
        if not should_send_telegram:
            notification.status = "stored"
            await self.db.commit()
            return notification

        if not self.settings.telegram_configured:
            notification.status = "disabled"
            notification.error_message = "Telegram niet geconfigureerd"
            await self.db.commit()
            return notification

        prefix = ""
        if severity == "critical":
            prefix = "[CRITICAL] "
        elif severity == "error":
            prefix = "[ERROR] "
        text = f"{prefix}{title}\n\n{message}"[:4096]
        try:
            json_body: dict = {
                "chat_id": self.settings.telegram_chat_id,
                "text": text,
                "disable_web_page_preview": True,
            }
            if reply_markup:
                json_body["reply_markup"] = reply_markup
            async with httpx.AsyncClient(timeout=10) as client:
                response = await client.post(
                    f"https://api.telegram.org/bot{self.settings.telegram_bot_token}/sendMessage",
                    json=json_body,
                )
                response.raise_for_status()
                payload = response.json().get("result", {})
                notification.external_message_id = str(payload.get("message_id", "")) or None
                notification.status = "sent"
                notification.sent_at = datetime.now(timezone.utc)
        except Exception as exc:
            notification.status = "failed"
            notification.error_message = str(exc)[:500]
            logger.warning("Telegram notificatie mislukt voor %s: %s", event_type, exc)

        await self.db.commit()
        return notification

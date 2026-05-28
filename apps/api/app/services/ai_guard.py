import logging
from datetime import datetime, timezone, timedelta
from typing import Any

from app.database import AsyncSessionLocal
from app.models.audit import AuditLog
from app.services.notifications import NotificationService
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

PAUSE_KEY = "anthropic_disabled_until"
REASON_KEY = "anthropic_disabled_reason"
LAST_ALERT_KEY = "anthropic_last_alert_at"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def ai_pause_status() -> dict:
    until = _parse_dt(get_runtime_value(PAUSE_KEY, None))
    reason = get_runtime_value(REASON_KEY, None)
    paused = bool(until and until > _now())
    return {
        "paused": paused,
        "until": until.isoformat() if until else None,
        "reason": reason,
    }


def is_ai_paused() -> bool:
    return bool(ai_pause_status()["paused"])


def is_ai_failure(exc: Exception) -> bool:
    text = str(exc).lower()
    needles = [
        "credit balance is too low",
        "billing",
        "insufficient credits",
        "rate_limit",
        "rate limit",
        "429",
        "overloaded",
        "529",
        "anthropic",
    ]
    return any(n in text for n in needles)


def pause_minutes_for_error(exc: Exception) -> int:
    text = str(exc).lower()
    if "credit balance is too low" in text or "billing" in text or "insufficient credits" in text:
        return 360
    if "rate" in text or "429" in text:
        return 30
    return 15


async def pause_ai(source: str, exc: Exception, *, minutes: int | None = None) -> None:
    minutes = minutes or pause_minutes_for_error(exc)
    until = _now() + timedelta(minutes=minutes)
    reason = str(exc)[:900]
    await _set_ai_pause(source, reason, until, minutes, status="error", notify=True)


async def manual_pause_ai(source: str, reason: str, *, minutes: int = 360) -> None:
    until = _now() + timedelta(minutes=minutes)
    await _set_ai_pause(source, reason[:900], until, minutes, status="skipped", notify=False)


async def _set_ai_pause(
    source: str,
    reason: str,
    until: datetime,
    minutes: int,
    *,
    status: str,
    notify: bool,
) -> None:
    set_runtime_value(PAUSE_KEY, until.isoformat())
    set_runtime_value(REASON_KEY, reason)

    logger.error("AI provider paused by %s until %s: %s", source, until.isoformat(), reason)

    should_alert = notify
    last_alert = _parse_dt(get_runtime_value(LAST_ALERT_KEY, None))
    if last_alert and (_now() - last_alert) < timedelta(minutes=55):
        should_alert = False

    async with AsyncSessionLocal() as db:
        db.add(AuditLog(
            action="ai_provider_paused",
            actor=source,
            entity_type="ai_provider",
            entity_id="anthropic",
            details={"until": until.isoformat(), "minutes": minutes, "reason": reason},
            status=status,
            message=reason[:500],
            created_at=_now(),
            updated_at=_now(),
        ))
        await db.commit()
        if should_alert:
            set_runtime_value(LAST_ALERT_KEY, _now().isoformat())
            await NotificationService(db).send(
                "ai_provider_paused",
                "Trading OS - AI analyse gepauzeerd",
                (
                    f"Claude/Anthropic geeft fouten en is tijdelijk gepauzeerd tot {until.isoformat()}.\n"
                    f"Oorzaak: {reason[:700]}\n\n"
                    "Data-ingest, position monitoring en auto-trade op bestaande signalen blijven doorlopen. "
                    "Nieuwe AI-analyse/signalen worden overgeslagen tot de pauze is verlopen of handmatig wordt gereset."
                ),
                severity="critical",
                entity_type="ai_provider",
                entity_id="anthropic",
            )


def resume_ai() -> None:
    set_runtime_value(PAUSE_KEY, None)
    set_runtime_value(REASON_KEY, None)

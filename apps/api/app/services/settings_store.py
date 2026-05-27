import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.settings import Setting
from app.services.runtime_state import set_runtime_value

logger = logging.getLogger(__name__)

RUNTIME_SETTING_KEYS = {
    "kill_switch_enabled",
    "live_trading_enabled",
    "require_manual_confirmation",
    "trading_mode",
}


def _value_type(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    return "string"


async def persist_runtime_setting(db: AsyncSession, key: str, value: Any) -> None:
    """Store a safety setting durably; Redis remains the worker coordination path."""
    if key not in RUNTIME_SETTING_KEYS:
        raise ValueError(f"Unsupported runtime setting: {key}")

    result = await db.execute(select(Setting).where(Setting.key == key))
    setting = result.scalar_one_or_none()
    serialized = json.dumps(value)

    if setting is None:
        setting = Setting(
            key=key,
            value=serialized,
            value_type=_value_type(value),
            description="Runtime safety setting managed by the dashboard",
        )
        db.add(setting)
    else:
        setting.value = serialized
        setting.value_type = _value_type(value)

    await db.commit()


async def hydrate_runtime_settings(db: AsyncSession) -> None:
    """Restore persisted safety settings into the shared Redis runtime state."""
    result = await db.execute(select(Setting).where(Setting.key.in_(RUNTIME_SETTING_KEYS)))
    for setting in result.scalars().all():
        try:
            value = json.loads(setting.value)
        except (TypeError, json.JSONDecodeError):
            logger.warning("Ongeldige opgeslagen runtime instelling genegeerd: %s", setting.key)
            continue
        set_runtime_value(setting.key, value)

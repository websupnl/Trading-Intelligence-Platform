"""Settings API - durable safety toggles with Redis propagation."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.audit import AuditLogService
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.settings_store import persist_runtime_setting
import app.config as cfg_module

router = APIRouter(prefix="/api/settings")
logger = logging.getLogger(__name__)

_runtime_overrides: dict = {}


def _effective_settings():
    """Get settings with runtime overrides applied."""
    s = cfg_module.get_settings()
    return s


@router.get("")
async def get_settings_endpoint():
    s = _effective_settings()
    return {
        "trading_mode": get_runtime_value("trading_mode", s.trading_mode),
        "live_trading_enabled": get_runtime_value("live_trading_enabled", s.live_trading_enabled),
        "kill_switch_enabled": get_runtime_value("kill_switch_enabled", s.kill_switch_enabled),
        "require_manual_confirmation": get_runtime_value("require_manual_confirmation", s.require_manual_confirmation),
        "use_mock_data": s.use_mock_data,
        "default_ai_provider": s.default_ai_provider,
        "anthropic_model": s.anthropic_model,
        "alpaca_configured": s.alpaca_configured,
        "anthropic_configured": s.anthropic_configured,
        "openai_configured": s.openai_configured,
        "reddit_configured": s.reddit_configured,
        "x_configured": s.x_configured,
        "telegram_configured": s.telegram_configured,
        "news_feed_count": len(s.news_feed_list),
        "crypto_feed_count": len(s.crypto_feed_list),
        "runtime_overrides": list(_runtime_overrides.keys()),
    }


@router.patch("/runtime")
async def update_runtime_settings(body: dict, db: AsyncSession = Depends(get_db)):
    """
    Toggle runtime settings without restarting.
    Supported keys: require_manual_confirmation, live_trading_enabled, trading_mode
    Note: kill_switch is managed via /api/risk/kill-switch endpoints.
    """
    audit = AuditLogService(db)
    allowed_keys = {"require_manual_confirmation", "live_trading_enabled", "trading_mode"}
    changed = {}

    invalid = {
        key: value for key, value in body.items()
        if (
            key in {"require_manual_confirmation", "live_trading_enabled"} and not isinstance(value, bool)
        ) or (
            key == "trading_mode" and value not in {"paper", "live"}
        )
    }
    if invalid:
        raise HTTPException(status_code=422, detail={"invalid_runtime_settings": invalid})

    for key, value in body.items():
        if key not in allowed_keys:
            continue
        if not set_runtime_value(key, value):
            raise HTTPException(
                status_code=503,
                detail="Instelling niet gewijzigd: workerbevestiging via Redis is mislukt.",
            )
        _runtime_overrides[key] = value
        await persist_runtime_setting(db, key, value)
        changed[key] = value

    if changed:
        # Patch the already-cached settings object directly in-process.
        # Do NOT clear lru_cache — that would create a fresh object from .env.
        # object.__setattr__ bypasses pydantic's immutability protection.
        s = cfg_module.get_settings()
        for key, value in changed.items():
            try:
                object.__setattr__(s, key, value)
            except Exception as e:
                logger.warning(f"Settings patch mislukt voor {key}: {e}")

        await audit.log(
            "settings_updated",
            actor="user",
            details={"changed": changed},
            message=f"Runtime instellingen bijgewerkt: {', '.join(f'{k}={v}' for k,v in changed.items())}",
        )

    return {
        "status": "updated",
        "changed": changed,
        "note": "Opgeslagen en gedeeld met workers via Redis.",
    }

"""
Settings API — read + runtime toggles.
Uses _runtime_overrides dict for in-memory overrides (cleared on restart).
For permanent changes: update .env and redeploy.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.audit import AuditLogService
import app.config as cfg_module

router = APIRouter(prefix="/api/settings")

# In-memory runtime overrides (reset on restart)
_runtime_overrides: dict = {}


def _effective_settings():
    """Get settings with runtime overrides applied."""
    s = cfg_module.get_settings()
    return s


@router.get("")
async def get_settings_endpoint():
    s = _effective_settings()
    return {
        "trading_mode": _runtime_overrides.get("trading_mode", s.trading_mode),
        "live_trading_enabled": _runtime_overrides.get("live_trading_enabled", s.live_trading_enabled),
        "kill_switch_enabled": _runtime_overrides.get("kill_switch_enabled", s.kill_switch_enabled),
        "require_manual_confirmation": _runtime_overrides.get("require_manual_confirmation", s.require_manual_confirmation),
        "use_mock_data": s.use_mock_data,
        "default_ai_provider": s.default_ai_provider,
        "anthropic_model": s.anthropic_model,
        "alpaca_configured": s.alpaca_configured,
        "anthropic_configured": s.anthropic_configured,
        "openai_configured": s.openai_configured,
        "reddit_configured": s.reddit_configured,
        "x_configured": s.x_configured,
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

    for key, value in body.items():
        if key not in allowed_keys:
            continue
        _runtime_overrides[key] = value
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
        "note": "Tijdelijke wijziging — update .env voor permanente instelling",
    }

"""Settings API - durable safety toggles with Redis propagation."""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.audit import AuditLogService
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.settings_store import persist_runtime_setting
from app.services.crypto_session import is_crypto_24_7_enabled, set_crypto_24_7
import app.config as cfg_module

router = APIRouter(prefix="/api/settings")
logger = logging.getLogger(__name__)

_runtime_overrides: dict = {}


def _effective_settings():
    return cfg_module.get_settings()


@router.get("")
async def get_settings_endpoint():
    s = _effective_settings()
    return {
        # Toggles
        "trading_mode": get_runtime_value("trading_mode", s.trading_mode),
        "live_trading_enabled": get_runtime_value("live_trading_enabled", s.live_trading_enabled),
        "kill_switch_enabled": get_runtime_value("kill_switch_enabled", s.kill_switch_enabled),
        "require_manual_confirmation": get_runtime_value("require_manual_confirmation", s.require_manual_confirmation),
        "use_mock_data": s.use_mock_data,
        "crypto_24_7_enabled": is_crypto_24_7_enabled(),
        "micro_trading_enabled": get_runtime_value("micro_trading_enabled", False),
        "allow_short_selling": get_runtime_value("allow_short_selling", s.allow_short_selling),
        # Risk limits
        "position_size_pct": get_runtime_value("position_size_pct", s.position_size_pct),
        "max_position_size_usd": get_runtime_value("max_position_size_usd", s.max_position_size_usd),
        "max_open_positions": int(get_runtime_value("max_open_positions", s.max_open_positions)),
        "max_trades_per_day": int(get_runtime_value("max_trades_per_day", s.max_trades_per_day)),
        "max_daily_loss_pct": get_runtime_value("max_daily_loss_pct", s.max_daily_loss_pct),
        "min_confidence_for_auto": get_runtime_value("min_confidence_for_auto", s.min_confidence_for_auto),
        "manual_approval_threshold": get_runtime_value("manual_approval_threshold", s.manual_approval_threshold),
        # AI budget
        "ai_daily_budget_usd": get_runtime_value("ai_daily_budget_usd", s.ai_daily_budget_usd),
        # AI model config
        "default_ai_provider": s.default_ai_provider,
        "anthropic_model": s.anthropic_model,
        "anthropic_analysis_model": s.anthropic_analysis_model,
        "anthropic_max_tokens": s.anthropic_max_tokens,
        "anthropic_enable_prompt_caching": s.anthropic_enable_prompt_caching,
        "anthropic_enable_web_search": s.anthropic_enable_web_search,
        # Integration status
        "alpaca_configured": s.alpaca_configured,
        "bitvavo_configured": s.bitvavo_configured,
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
    Bool keys: require_manual_confirmation, live_trading_enabled, crypto_24_7_enabled,
               micro_trading_enabled, allow_short_selling
    Numeric keys: position_size_pct, max_position_size_usd, max_daily_loss_pct,
                  min_confidence_for_auto, manual_approval_threshold, ai_daily_budget_usd,
                  max_open_positions, max_trades_per_day
    String keys: trading_mode (paper|live)
    """
    audit = AuditLogService(db)

    bool_keys = {
        "require_manual_confirmation", "live_trading_enabled", "crypto_24_7_enabled",
        "micro_trading_enabled", "allow_short_selling",
    }
    float_keys = {
        "position_size_pct", "max_position_size_usd", "max_daily_loss_pct",
        "min_confidence_for_auto", "manual_approval_threshold", "ai_daily_budget_usd",
    }
    int_keys = {"max_open_positions", "max_trades_per_day"}
    allowed_keys = bool_keys | float_keys | int_keys | {"trading_mode"}

    # Validation
    invalid: dict = {}
    for key, value in body.items():
        if key not in allowed_keys:
            continue
        if key in bool_keys and not isinstance(value, bool):
            invalid[key] = value
        elif key == "trading_mode" and value not in {"paper", "live"}:
            invalid[key] = value
        elif key in float_keys:
            try:
                float(value)
            except (TypeError, ValueError):
                invalid[key] = value
        elif key in int_keys:
            try:
                int(value)
            except (TypeError, ValueError):
                invalid[key] = value
    if invalid:
        raise HTTPException(status_code=422, detail={"invalid_runtime_settings": invalid})

    changed = {}
    for key, value in body.items():
        if key not in allowed_keys:
            continue
        # Coerce numeric types
        if key in float_keys:
            value = float(value)
        elif key in int_keys:
            value = int(value)

        if key == "crypto_24_7_enabled":
            if not set_crypto_24_7(value):
                raise HTTPException(status_code=503, detail="crypto_24_7_enabled kon niet worden opgeslagen in Redis.")
            _runtime_overrides[key] = value
            changed[key] = value
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

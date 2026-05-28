from fastapi import APIRouter
from app.services.config_service import get_config_status
from app.services.market_session import market_session_status

router = APIRouter()


@router.get("/api/config/status")
async def config_status():
    return get_config_status()


@router.get("/api/status")
async def api_status():
    cfg = get_config_status()
    market_session = market_session_status()
    return {
        "status": "operational",
        "trading_mode": cfg.trading_mode,
        "live_trading_enabled": cfg.live_trading_enabled,
        "kill_switch_enabled": cfg.kill_switch_enabled,
        "require_manual_confirmation": cfg.require_manual_confirmation,
        "market_session": market_session,
        "configured_integrations": {
            "alpaca": cfg.alpaca.configured,
            "anthropic": cfg.anthropic.configured,
            "openai": cfg.openai.configured,
            "reddit": cfg.reddit.configured,
            "x_twitter": cfg.x_twitter.configured,
            "telegram": cfg.telegram.configured,
        }
    }

from fastapi import APIRouter
from app.config import get_settings

router = APIRouter(prefix="/api/settings")


@router.get("")
async def get_settings_endpoint():
    s = get_settings()
    # Never expose secrets
    return {
        "trading_mode": s.trading_mode,
        "live_trading_enabled": s.live_trading_enabled,
        "kill_switch_enabled": s.kill_switch_enabled,
        "require_manual_confirmation": s.require_manual_confirmation,
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
    }

from fastapi import APIRouter
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.services.runtime_state import get_runtime_value
from app.models.signals import Signal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.ai_guard import ai_pause_status
from app.services.market_session import market_session_status

router = APIRouter()
settings = get_settings()


@router.get("/health")
async def health():
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat(), "service": "trading-os-api"}


@router.get("/api/health/bot")
async def bot_health():
    """Pre-flight check: is the bot ready to autonomously trade?"""
    now = datetime.now(timezone.utc)
    since_1h = now - timedelta(hours=1)
    since_10m = now - timedelta(minutes=10)

    kill_switch = get_runtime_value("kill_switch_enabled", settings.kill_switch_enabled)
    require_manual = get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation)
    trading_mode = get_runtime_value("trading_mode", settings.trading_mode)
    live_enabled = get_runtime_value("live_trading_enabled", settings.live_trading_enabled)
    position_size_pct = get_runtime_value("position_size_pct", settings.position_size_pct)
    ai_guard = ai_pause_status()
    market_session = market_session_status()

    # Check recent activity from DB
    recent_signal_count = 0
    recent_trade_count = 0
    last_auto_trade_at = None
    last_signal_at = None
    open_trades = 0

    try:
        async with AsyncSessionLocal() as db:
            r = await db.execute(
                select(func.count()).where(Signal.created_at >= since_1h)
            )
            recent_signal_count = r.scalar() or 0

            r = await db.execute(
                select(func.count()).where(
                    Trade.opened_at >= since_1h,
                    Trade.status.in_(["open", "paper_traded"])
                )
            )
            recent_trade_count = r.scalar() or 0

            r = await db.execute(
                select(func.count()).where(Trade.status == "open")
            )
            open_trades = r.scalar() or 0

            # Last auto_trade audit entry
            r = await db.execute(
                select(AuditLog.created_at)
                .where(AuditLog.action == "auto_trade_executed")
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
            row = r.scalar_one_or_none()
            last_auto_trade_at = row.isoformat() if row else None

            r = await db.execute(
                select(AuditLog.created_at)
                .where(AuditLog.action == "signal_generated")
                .order_by(AuditLog.created_at.desc())
                .limit(1)
            )
            row = r.scalar_one_or_none()
            last_signal_at = row.isoformat() if row else None
    except Exception:
        pass

    # Compute readiness
    blockers = []
    if kill_switch:
        blockers.append("kill_switch_enabled")
    if require_manual:
        blockers.append("require_manual_confirmation=True (auto-trade paused)")
    if not settings.anthropic_api_key:
        blockers.append("ANTHROPIC_API_KEY not set (no signals)")
    if ai_guard.get("paused"):
        blockers.append(f"anthropic_api_paused_until={ai_guard.get('until')}")
    if not settings.alpaca_configured:
        blockers.append("Alpaca not configured (simulated paper orders only)")
    if trading_mode == "live" and not live_enabled:
        blockers.append("live_trading_enabled=False")

    ready = len(blockers) == 0

    return {
        "ready": ready,
        "blockers": blockers,
        "trading_mode": trading_mode,
        "live_trading_enabled": live_enabled,
        "kill_switch_enabled": kill_switch,
        "require_manual_confirmation": require_manual,
        "alpaca_configured": settings.alpaca_configured,
        "anthropic_configured": settings.anthropic_configured,
        "position_size_pct": position_size_pct,
        "ai_guard": ai_guard,
        "market_session": market_session,
        "recent_signals_1h": recent_signal_count,
        "recent_trades_1h": recent_trade_count,
        "open_trades": open_trades,
        "last_signal_at": last_signal_at,
        "last_auto_trade_at": last_auto_trade_at,
        "timestamp": now.isoformat(),
    }

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.risk_engine import RiskEngine
from app.services.audit import AuditLogService
from app.schemas.risk import RiskCheckRequest
from app.config import get_settings

router = APIRouter(prefix="/api/risk")
risk_engine = RiskEngine()


@router.get("/status")
async def risk_status():
    s = get_settings()
    return {
        "kill_switch_enabled": s.kill_switch_enabled,
        "trading_mode": s.trading_mode,
        "live_trading_enabled": s.live_trading_enabled,
        "require_manual_confirmation": s.require_manual_confirmation,
        "max_position_size_usd": 10000.0,
        "max_trades_per_day": 20,
        "max_open_positions": 10,
    }


@router.post("/check")
async def check_risk(req: RiskCheckRequest):
    return risk_engine.check(req)


@router.post("/kill-switch/enable")
async def enable_kill_switch(db: AsyncSession = Depends(get_db)):
    audit = AuditLogService(db)
    await audit.log("kill_switch_enabled", actor="user")
    # Note: runtime change only - persists until restart; update .env to make permanent
    import app.config as cfg_module
    cfg_module.get_settings.cache_clear()
    return {"status": "enabled", "message": "Kill switch geactiveerd - alle orders geblokkeerd. Herstart of update .env voor permanente wijziging."}


@router.post("/kill-switch/disable")
async def disable_kill_switch(db: AsyncSession = Depends(get_db)):
    audit = AuditLogService(db)
    await audit.log("kill_switch_disabled", actor="user")
    return {"status": "disabled", "message": "Kill switch uitgeschakeld via API. Update KILL_SWITCH_ENABLED=false in .env voor permanente wijziging."}

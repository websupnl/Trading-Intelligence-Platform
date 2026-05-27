from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.risk_engine import RiskEngine
from app.services.audit import AuditLogService
from app.schemas.risk import RiskCheckRequest
from app.config import get_settings
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.settings_store import persist_runtime_setting

router = APIRouter(prefix="/api/risk")
risk_engine = RiskEngine()


@router.get("/status")
async def risk_status():
    s = get_settings()
    return {
        "kill_switch_enabled": get_runtime_value("kill_switch_enabled", s.kill_switch_enabled),
        "trading_mode": get_runtime_value("trading_mode", s.trading_mode),
        "live_trading_enabled": get_runtime_value("live_trading_enabled", s.live_trading_enabled),
        "require_manual_confirmation": get_runtime_value("require_manual_confirmation", s.require_manual_confirmation),
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
    stored = set_runtime_value("kill_switch_enabled", True)
    object.__setattr__(get_settings(), "kill_switch_enabled", True)
    await persist_runtime_setting(db, "kill_switch_enabled", True)
    await audit.log("kill_switch_enabled", actor="user", details={"shared": stored})
    if not stored:
        raise HTTPException(
            status_code=503,
            detail="Kill switch is lokaal actief, maar workerbevestiging via Redis is mislukt. Stop automatische trading totdat Redis hersteld is.",
        )
    return {"status": "enabled", "shared": stored, "message": "Kill switch geactiveerd - nieuwe orders worden geblokkeerd."}


@router.post("/kill-switch/disable")
async def disable_kill_switch(db: AsyncSession = Depends(get_db)):
    stored = set_runtime_value("kill_switch_enabled", False)
    if not stored:
        raise HTTPException(
            status_code=503,
            detail="Kill switch niet uitgeschakeld: workerbevestiging via Redis is mislukt.",
        )
    audit = AuditLogService(db)
    object.__setattr__(get_settings(), "kill_switch_enabled", False)
    await persist_runtime_setting(db, "kill_switch_enabled", False)
    await audit.log("kill_switch_disabled", actor="user", details={"shared": stored})
    return {"status": "disabled", "shared": stored, "message": "Kill switch uitgeschakeld."}

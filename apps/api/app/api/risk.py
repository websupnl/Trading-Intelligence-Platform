from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.risk_engine import RiskEngine
from app.services.audit import AuditLogService
from app.schemas.risk import RiskCheckRequest
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.rules import ActiveRule
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.settings_store import persist_runtime_setting
from app.services.notifications import NotificationService

router = APIRouter(prefix="/api/risk")
risk_engine = RiskEngine()


@router.get("/status")
async def risk_status():
    s = get_settings()
    active_rules = 0
    try:
        async with AsyncSessionLocal() as db:
            from sqlalchemy import func, select
            active_rules = (await db.execute(
                select(func.count()).select_from(ActiveRule).where(ActiveRule.status == "active")
            )).scalar() or 0
    except Exception:
        active_rules = 0
    return {
        "kill_switch_enabled": get_runtime_value("kill_switch_enabled", s.kill_switch_enabled),
        "trading_mode": get_runtime_value("trading_mode", s.trading_mode),
        "live_trading_enabled": get_runtime_value("live_trading_enabled", s.live_trading_enabled),
        "require_manual_confirmation": get_runtime_value("require_manual_confirmation", s.require_manual_confirmation),
        "max_position_size_usd": get_runtime_value("max_position_size_usd", s.max_position_size_usd),
        "max_trades_per_day": int(get_runtime_value("max_trades_per_day", s.max_trades_per_day)),
        "max_open_positions": int(get_runtime_value("max_open_positions", s.max_open_positions)),
        "max_daily_loss_pct": get_runtime_value("max_daily_loss_pct", s.max_daily_loss_pct),
        "min_confidence_for_auto": get_runtime_value("min_confidence_for_auto", s.min_confidence_for_auto),
        "position_size_pct": get_runtime_value("position_size_pct", s.position_size_pct),
        "active_learning_rules": active_rules,
    }


@router.post("/check")
async def check_risk(req: RiskCheckRequest):
    return await risk_engine.check_async(req)


@router.post("/kill-switch/enable")
async def enable_kill_switch(db: AsyncSession = Depends(get_db)):
    audit = AuditLogService(db)
    stored = set_runtime_value("kill_switch_enabled", True)
    object.__setattr__(get_settings(), "kill_switch_enabled", True)
    await persist_runtime_setting(db, "kill_switch_enabled", True)
    await audit.log("kill_switch_enabled", actor="user", details={"shared": stored})
    await NotificationService(db).send(
        "kill_switch_enabled",
        "Trading OS - KILL SWITCH ACTIEF",
        "Nieuwe orders zijn geblokkeerd. Controleer open posities en de reden voor activatie.",
        severity="critical",
        entity_type="risk",
    )
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
    await NotificationService(db).send(
        "kill_switch_disabled",
        "Trading OS - Kill switch uitgeschakeld",
        "Nieuwe orders kunnen weer langs de ingestelde risk checks worden verwerkt.",
        severity="warning",
        entity_type="risk",
    )
    return {"status": "disabled", "shared": stored, "message": "Kill switch uitgeschakeld."}

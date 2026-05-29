from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.trades import Trade
from app.services.alpaca_broker import CRYPTO_SYMBOLS
from app.services.audit import AuditLogService
from app.services.crypto_session import get_crypto_session, start_crypto_session, stop_crypto_session
from app.workers.celery_app import celery_app

router = APIRouter(prefix="/api/crypto-session")


class StartCryptoSessionRequest(BaseModel):
    duration_minutes: int = Field(default=120, ge=15, le=480)
    session_budget: float = Field(default=100.0, ge=10.0, le=10000.0)
    max_trades: int = Field(default=10, ge=1, le=50)
    stop_loss_pct: float = Field(default=0.20, ge=0.05, le=0.80)
    note: str | None = Field(default=None, max_length=240)


@router.get("/status")
async def status(db: AsyncSession = Depends(get_db)):
    session = get_crypto_session()
    started_at = session.get("started_at")
    stats = {"trades_open": 0, "trades_closed": 0, "realized_pnl": 0.0}
    if session.get("active") and started_at:
        try:
            session_start = datetime.fromisoformat(str(started_at))
            open_result = await db.execute(
                select(func.count()).where(
                    Trade.opened_at >= session_start,
                    Trade.symbol.in_(CRYPTO_SYMBOLS),
                    Trade.status == "open",
                )
            )
            closed_result = await db.execute(
                select(func.count(), func.sum(Trade.pnl)).where(
                    Trade.opened_at >= session_start,
                    Trade.symbol.in_(CRYPTO_SYMBOLS),
                    Trade.status == "closed",
                )
            )
            stats["trades_open"] = int(open_result.scalar() or 0)
            row = closed_result.one()
            stats["trades_closed"] = int(row[0] or 0)
            stats["realized_pnl"] = round(float(row[1] or 0), 2)
        except Exception:
            pass
    return {**session, **stats}


@router.post("/start")
async def start(req: StartCryptoSessionRequest, db: AsyncSession = Depends(get_db)):
    session = start_crypto_session(
        duration_minutes=req.duration_minutes,
        session_budget=req.session_budget,
        max_trades=req.max_trades,
        stop_loss_pct=req.stop_loss_pct,
        note=req.note,
    )
    await AuditLogService(db).log(
        "crypto_session_started",
        actor="user",
        entity_type="crypto_session",
        entity_id=session.get("session_id"),
        details=session,
        message="Autonome crypto-sessie gestart",
    )
    celery_app.send_task("app.tasks.analysis_tasks.run_crypto_session")
    return session


@router.post("/stop")
async def stop(db: AsyncSession = Depends(get_db)):
    session = stop_crypto_session("manual")
    await AuditLogService(db).log(
        "crypto_session_stopped",
        actor="user",
        entity_type="crypto_session",
        entity_id=session.get("session_id"),
        details=session,
        message="Autonome crypto-sessie gestopt",
    )
    return get_crypto_session()

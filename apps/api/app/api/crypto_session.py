from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.services.audit import AuditLogService
from app.services.crypto_session import get_crypto_session, start_crypto_session, stop_crypto_session
from app.workers.celery_app import celery_app

router = APIRouter(prefix="/api/crypto-session")


class StartCryptoSessionRequest(BaseModel):
    duration_minutes: int = Field(default=120, ge=15, le=480)
    max_notional_per_trade: float = Field(default=250.0, ge=25.0, le=2500.0)
    max_trades: int = Field(default=5, ge=1, le=25)
    note: str | None = Field(default=None, max_length=240)


@router.get("/status")
async def status():
    return get_crypto_session()


@router.post("/start")
async def start(req: StartCryptoSessionRequest, db: AsyncSession = Depends(get_db)):
    session = start_crypto_session(
        duration_minutes=req.duration_minutes,
        max_notional_per_trade=req.max_notional_per_trade,
        max_trades=req.max_trades,
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

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.outcomes import SignalOutcome
from app.services.audit import AuditLogService
from app.services.outcome_engine import OutcomeEngine

router = APIRouter(prefix="/api/outcomes")


@router.get("/summary")
async def get_outcome_summary(db: AsyncSession = Depends(get_db)):
    return await OutcomeEngine(db).summary()


@router.get("/signals")
async def get_signal_outcomes(limit: int = Query(100, ge=1, le=500), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(SignalOutcome).order_by(desc(SignalOutcome.signal_created_at)).limit(limit)
    )
    return [
        {
            "id": item.id,
            "signal_id": item.signal_id,
            "symbol": item.symbol,
            "direction": item.direction,
            "signal_created_at": item.signal_created_at,
            "entry_price": item.entry_price,
            "return_1d": item.return_1d,
            "return_5d": item.return_5d,
            "pnl_1d_pct": item.pnl_1d_pct,
            "pnl_5d_pct": item.pnl_5d_pct,
            "mfe_pct": item.mfe_pct,
            "mae_pct": item.mae_pct,
            "benchmark_return_5d": item.benchmark_return_5d,
            "excess_return_5d": item.excess_return_5d,
            "outcome_status": item.outcome_status,
            "evaluated_at": item.evaluated_at,
        }
        for item in result.scalars().all()
    ]


@router.post("/evaluate")
async def evaluate_outcomes(db: AsyncSession = Depends(get_db)):
    result = await OutcomeEngine(db).evaluate_signals()
    await AuditLogService(db).log("signal_outcomes_evaluated", actor="user", details=result)
    return result

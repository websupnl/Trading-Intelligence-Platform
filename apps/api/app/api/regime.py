from fastapi import APIRouter
from sqlalchemy import desc, select

from app.database import AsyncSessionLocal
from app.models.regime import RegimeState
from app.services.regime_detector import detect_oracle_regime, get_current_oracle_regime

router = APIRouter(prefix="/api/v1/regime", tags=["regime"])


@router.get("/current")
async def current_regime():
    return await get_current_oracle_regime()


@router.post("/refresh")
async def refresh_regime():
    return await detect_oracle_regime(persist=True)


@router.get("/history")
async def regime_history(limit: int = 30):
    limit = max(1, min(limit, 100))
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(RegimeState)
            .order_by(desc(RegimeState.computed_at))
            .limit(limit)
        )
        states = result.scalars().all()
    return [
        {
            "id": state.id,
            "regime": state.regime,
            "confidence": state.confidence,
            "vix": state.vix,
            "spy_vs_ema50": state.spy_vs_ema50,
            "spy_vs_ema200": state.spy_vs_ema200,
            "btc_dominance": state.btc_dominance,
            "dollar_trend": state.dollar_trend,
            "computed_at": state.computed_at.isoformat(),
            "notes": state.notes,
            "metrics": state.metrics,
        }
        for state in states
    ]

from fastapi import APIRouter

from app.services.regime_detector import detect_oracle_regime, get_current_oracle_regime

router = APIRouter(prefix="/api/v1/regime", tags=["regime"])


@router.get("/current")
async def current_regime():
    return await get_current_oracle_regime()


@router.post("/refresh")
async def refresh_regime():
    return await detect_oracle_regime(persist=True)

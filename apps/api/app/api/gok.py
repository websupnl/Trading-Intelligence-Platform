"""Gok Sessie API — AI-driven speculative one-shot trades."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.services.gok_session import GokSessionService

router = APIRouter(prefix="/api/gok")


class GokExecuteRequest(BaseModel):
    asset: str
    budget_eur: float
    price: float


@router.get("/status")
async def gok_status():
    """Check if a gok sessie can be started."""
    svc = GokSessionService()
    can, reason = await svc.can_start_gok()
    return {"can_start": can, "reason": reason}


@router.get("/scan")
async def gok_scan(budget: float = 100.0):
    """AI scans for the best speculative opportunity right now."""
    svc = GokSessionService()
    can, reason = await svc.can_start_gok()
    if not can:
        raise HTTPException(status_code=400, detail=reason)
    result = await svc.scan_best_opportunity(budget_eur=budget)
    return result


@router.post("/execute")
async def gok_execute(body: GokExecuteRequest):
    """Execute the gok trade after user confirmation."""
    svc = GokSessionService()
    can, reason = await svc.can_start_gok()
    if not can:
        raise HTTPException(status_code=400, detail=reason)
    if body.budget_eur < 10:
        raise HTTPException(status_code=400, detail="Minimum gok bedrag is €10")
    result = await svc.execute_gok(
        asset=body.asset,
        budget_eur=body.budget_eur,
        price=body.price,
    )
    if result.get("status") == "error":
        raise HTTPException(status_code=500, detail=result["message"])
    return result

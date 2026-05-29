"""Polymarket API — read-only market intelligence. No order placement."""
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.polymarket import PolymarketPosition
from app.services.polymarket_service import PolymarketService
from app.services.polymarket_analyzer import PolymarketAnalyzer
from app.services.runtime_state import get_runtime_value, set_runtime_value

router = APIRouter(prefix="/api/polymarket")


def _get_service() -> PolymarketService:
    s = get_settings()
    return PolymarketService(
        api_key=s.polymarket_api_key,
        secret=s.polymarket_secret,
        passphrase=s.polymarket_passphrase,
    )


@router.get("/markets")
async def get_markets(
    crypto_only: bool = True,
    max_hours: int = 24,
    min_volume: float = 200.0,
    with_analysis: bool = False,
):
    """Fetch active Polymarket markets, optionally with AI edge analysis."""
    svc = _get_service()
    markets = await svc.get_markets(
        crypto_only=crypto_only,
        max_end_hours=max_hours,
        min_volume=min_volume,
    )

    if with_analysis and markets:
        analyzer = PolymarketAnalyzer()
        for market in markets[:12]:
            analysis = await analyzer.analyze_market(market)
            market["ai_analysis"] = analysis

    settings = get_settings()
    return {
        "markets": markets,
        "configured": svc.is_configured,
        "min_edge_alert": get_runtime_value("polymarket_min_edge", settings.polymarket_min_edge),
    }


@router.post("/analyze/{condition_id}")
async def analyze_market(condition_id: str, market_data: dict[str, Any]):
    """Run AI analysis on a specific market and return edge assessment."""
    analyzer = PolymarketAnalyzer()
    analysis = await analyzer.analyze_market(market_data)
    if not analysis:
        raise HTTPException(status_code=503, detail="AI analyse niet beschikbaar")
    return analysis


@router.get("/ticker/{ticker}")
async def get_markets_for_ticker(ticker: str, max_hours: int = 48):
    """Get Polymarket markets relevant to a specific crypto ticker."""
    svc = _get_service()
    markets = await svc.get_markets_for_ticker(ticker.upper(), max_hours=max_hours)
    return {"ticker": ticker.upper(), "markets": markets}


@router.get("/cache")
async def get_cached_markets():
    """Return the latest cached Polymarket data (from Celery task)."""
    cached = get_runtime_value("polymarket_markets_cache", [])
    return {"markets": cached, "count": len(cached)}


@router.get("/positions")
async def get_positions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PolymarketPosition)
        .where(PolymarketPosition.status == "open")
        .order_by(desc(PolymarketPosition.opened_at))
    )
    return result.scalars().all()


@router.get("/history")
async def get_history(limit: int = 50, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(PolymarketPosition)
        .where(PolymarketPosition.status != "open")
        .order_by(desc(PolymarketPosition.closed_at))
        .limit(limit)
    )
    return result.scalars().all()


@router.get("/settings")
async def get_poly_settings():
    settings = get_settings()
    return {
        "configured": bool(settings.polymarket_api_key),
        "min_edge_alert": get_runtime_value("polymarket_min_edge", settings.polymarket_min_edge),
        "data_only": True,
    }


@router.patch("/settings")
async def update_poly_settings(data: dict[str, Any]):
    if "min_edge" in data:
        set_runtime_value("polymarket_min_edge", float(data["min_edge"]))
    return await get_poly_settings()


@router.post("/refresh")
async def trigger_refresh():
    """Manually trigger a Polymarket data fetch."""
    from app.workers.celery_app import celery_app
    celery_app.send_task("app.tasks.polymarket_tasks.fetch_polymarket_data")
    return {"status": "triggered"}

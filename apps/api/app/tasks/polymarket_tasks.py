"""Polymarket data collection tasks — read-only market intelligence."""
import asyncio
import logging
from datetime import datetime, timezone

from app.workers.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.polymarket_tasks.fetch_polymarket_data")
def fetch_polymarket_data():
    """Fetch crypto Polymarket markets and store analysis cache in Redis.
    Runs every 5 min. Enriches signal generator with prediction market probabilities."""
    try:
        return asyncio.run(_fetch_and_cache())
    except Exception as e:
        logger.error(f"Polymarket fetch fout: {e}")
        return {"status": "error", "message": str(e)}


async def _fetch_and_cache() -> dict:
    import json
    from app.config import get_settings
    from app.services.polymarket_service import PolymarketService
    from app.services.runtime_state import set_runtime_value

    settings = get_settings()
    svc = PolymarketService(
        api_key=settings.polymarket_api_key,
        secret=settings.polymarket_secret,
        passphrase=settings.polymarket_passphrase,
    )

    markets = await svc.get_markets(crypto_only=True, max_end_hours=48, min_volume=200, limit=50)
    if not markets:
        return {"status": "ok", "markets": 0}

    # Cache in Redis for signal generator
    set_runtime_value("polymarket_markets_cache", markets)
    logger.info(f"Polymarket: {len(markets)} markten gecached")
    return {"status": "ok", "markets": len(markets)}


@celery_app.task(name="app.tasks.polymarket_tasks.update_position_prices")
def update_position_prices():
    """Update current prices for open Polymarket positions."""
    try:
        return asyncio.run(_update_prices())
    except Exception as e:
        logger.error(f"Polymarket price update fout: {e}")
        return {"status": "error", "message": str(e)}


async def _update_prices() -> dict:
    from app.config import get_settings
    from app.services.polymarket_service import PolymarketService
    from app.database import AsyncSessionLocal
    from app.models.polymarket import PolymarketPosition
    from sqlalchemy import select

    settings = get_settings()
    svc = PolymarketService(
        api_key=settings.polymarket_api_key,
        secret=settings.polymarket_secret,
        passphrase=settings.polymarket_passphrase,
    )

    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(PolymarketPosition).where(PolymarketPosition.status == "open")
        )
        positions = result.scalars().all()

    now = datetime.now(timezone.utc)
    updated = 0
    for pos in positions:
        if pos.market_end_date and pos.market_end_date <= now:
            async with AsyncSessionLocal() as db:
                r = await db.execute(select(PolymarketPosition).where(PolymarketPosition.id == pos.id))
                p = r.scalar_one_or_none()
                if p:
                    p.status = "pending_resolution"
                    await db.commit()
            continue

        token_id = pos.yes_token_id if pos.side == "yes" else pos.no_token_id
        if not token_id:
            continue
        price_data = await svc.get_token_price(token_id)
        current = price_data.get("mid") or price_data.get("buy")
        if current is None:
            continue

        async with AsyncSessionLocal() as db:
            r = await db.execute(select(PolymarketPosition).where(PolymarketPosition.id == pos.id))
            p = r.scalar_one_or_none()
            if p:
                p.current_price = current
                if p.invested_usd:
                    unrealized = round((current - p.avg_price) * p.shares, 4)
                    p.pnl = unrealized
                    p.pnl_pct = round(unrealized / p.invested_usd, 4)
                await db.commit()
        updated += 1

    return {"status": "ok", "updated": updated}

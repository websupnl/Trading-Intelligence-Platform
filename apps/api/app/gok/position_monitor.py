import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.gok import GokPosition, GokSession, GokScoreEvent
from app.services.market_data_service import MarketDataService
from app.gok.ws_manager import gok_ws_manager
from app.gok.strategies import get_strategy

logger = logging.getLogger(__name__)

MONITOR_INTERVAL_SECONDS = 15
_monitor_running = False


async def monitor_loop():
    """Achtergrond loop die open gok posities bewaakt en WS events stuurt."""
    global _monitor_running
    if _monitor_running:
        return
    _monitor_running = True
    logger.info("Gok position monitor gestart")
    mds = MarketDataService()

    try:
        while True:
            await asyncio.sleep(MONITOR_INTERVAL_SECONDS)
            try:
                await _check_positions(mds)
            except Exception as e:
                logger.error(f"Monitor loop fout: {e}")
    except asyncio.CancelledError:
        logger.info("Gok position monitor gestopt")
        _monitor_running = False


async def _check_positions(mds: MarketDataService):
    """Controleer alle open posities en sluit ze als TP/SL/timeout bereikt."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(GokPosition).where(GokPosition.status == "open")
        )
        positions = result.scalars().all()

    if not positions:
        return

    for position in positions:
        try:
            current_price = await mds.get_latest_price(position.asset)
            if not current_price:
                continue

            pnl = (current_price - position.entry_price) * position.quantity
            pnl_pct = (current_price - position.entry_price) / position.entry_price * 100

            # Stuur prijs update
            if gok_ws_manager.active_count > 0:
                await gok_ws_manager.broadcast("position_update", {
                    "position_id": position.id,
                    "asset": position.asset,
                    "current_price": current_price,
                    "pnl": round(pnl, 4),
                    "pnl_pct": round(pnl_pct, 4),
                    "tp_distance_pct": round(
                        (position.take_profit - current_price) / current_price * 100, 2
                    ) if position.take_profit else None,
                    "sl_distance_pct": round(
                        (current_price - position.stop_loss) / current_price * 100, 2
                    ) if position.stop_loss else None,
                })

            # Update current price in DB
            async with AsyncSessionLocal() as db:
                db_pos = await db.get(GokPosition, position.id)
                if not db_pos or db_pos.status != "open":
                    continue

                db_pos.current_price = current_price
                db_pos.pnl = round(pnl, 4)
                db_pos.pnl_pct = round(pnl_pct, 4)

                closed_reason = None

                # TP hit
                if position.take_profit and current_price >= position.take_profit:
                    closed_reason = "tp_hit"
                # SL hit
                elif position.stop_loss and current_price <= position.stop_loss:
                    closed_reason = "sl_hit"
                # Timeout check
                elif position.opened_at:
                    strategy = get_strategy(position.strategy_name)
                    max_hours = strategy.max_hold_hours if strategy else 6
                    age = datetime.now(timezone.utc) - position.opened_at.replace(tzinfo=timezone.utc) if position.opened_at.tzinfo is None else datetime.now(timezone.utc) - position.opened_at
                    if age > timedelta(hours=max_hours):
                        closed_reason = "timeout"

                if closed_reason:
                    db_pos.status = "closed"
                    db_pos.closed_reason = closed_reason
                    db_pos.closed_at = datetime.now(timezone.utc)
                    logger.info(f"Gok positie {position.id} gesloten: {closed_reason}, P&L: €{pnl:.2f}")

                    # Update sessie
                    if position.session_id:
                        session = await db.get(GokSession, position.session_id)
                        if session:
                            session.status = "closed"
                            session.outcome = "win" if pnl > 0 else "loss"
                            session.total_pnl = round(pnl, 4)
                            session.total_pnl_pct = round(pnl_pct, 4)
                            session.ended_at = datetime.now(timezone.utc)

                    # Score event
                    points = 100 if pnl > 0 else -20
                    db.add(GokScoreEvent(
                        session_id=position.session_id,
                        position_id=position.id,
                        event_type="trade_win" if pnl > 0 else "trade_loss",
                        points=points,
                        details={"pnl": round(pnl, 4), "reason": closed_reason},
                        recorded_at=datetime.now(timezone.utc),
                    ))

                await db.commit()

                if closed_reason:
                    await gok_ws_manager.broadcast("position_closed", {
                        "position_id": position.id,
                        "asset": position.asset,
                        "reason": closed_reason,
                        "pnl": round(pnl, 4),
                        "pnl_pct": round(pnl_pct, 4),
                    })

        except Exception as e:
            logger.error(f"Monitor fout voor positie {position.id}: {e}")

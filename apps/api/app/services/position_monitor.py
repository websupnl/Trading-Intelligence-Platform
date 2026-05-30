import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.database import AsyncSessionLocal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.market_data_service import MarketDataService
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError, CRYPTO_SYMBOLS
from app.services.notifications import NotificationService
from app.services.runtime_state import get_runtime_value
from app.config import get_settings

logger = logging.getLogger(__name__)


class PositionMonitorService:
    """Monitors open trades and executes SL/TP when price triggers are hit."""

    def __init__(self):
        self.settings = get_settings()
        self.broker = AlpacaBroker()
        self.market = MarketDataService()

    async def monitor(self, crypto_only: bool = False) -> int:
        """Check all open trades; close those that hit SL or TP. Returns count closed.
        crypto_only=True monitors only crypto assets (for outside US market hours)."""
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            return 0

        async with AsyncSessionLocal() as db:
            query = select(Trade).where(Trade.status == "open")
            if crypto_only:
                query = query.where(Trade.symbol.in_(CRYPTO_SYMBOLS))
            result = await db.execute(query)
            trades = result.scalars().all()

        if not trades:
            return 0

        closed = 0
        for trade in trades:
            try:
                if await self._check_and_close(trade):
                    closed += 1
            except Exception as e:
                logger.error(f"Positie monitor fout voor {trade.symbol} ({trade.id}): {e}")

        return closed

    MAX_HOLD_HOURS = 24  # sluit altijd na 24u — snellere rotatie, AI leert sneller

    async def _check_and_close(self, trade: Trade) -> bool:
        price = await self.market.get_latest_price(trade.symbol)
        if price is None:
            return False

        # Trailing stop: adjust SL upward as trade profits
        await self._apply_trailing_stop(trade, price)

        # SL/TP check
        if trade.stop_loss or trade.take_profit:
            triggered, reason, exit_price = self._is_triggered(trade, price)
            if triggered:
                await self._execute_close(trade, exit_price, reason)
                return True

        # Max hold time
        if trade.opened_at:
            age = datetime.now(timezone.utc) - trade.opened_at
            if age > timedelta(hours=self.MAX_HOLD_HOURS):
                reason = f"Max hold tijd ({self.MAX_HOLD_HOURS}u) bereikt @ ${price:.4f}"
                await self._execute_close(trade, price, reason)
                return True

        return False

    async def _apply_trailing_stop(self, trade: Trade, price: float) -> None:
        """Move SL up as position profits: breakeven at +2%, trail at +4%."""
        if trade.side.lower() not in ("buy", "long"):
            return
        if not trade.entry_price or trade.entry_price <= 0:
            return

        entry = trade.entry_price
        profit_pct = (price - entry) / entry * 100

        new_sl: float | None = None
        reason = ""

        if profit_pct >= 4.0:
            # Trail at 1.5% below current price — lock in gains
            trail = price * 0.985
            if trade.stop_loss is None or trail > trade.stop_loss:
                new_sl = round(trail, 6)
                reason = f"Trailing stop {profit_pct:.1f}% winst → SL=${new_sl:.4f}"
        elif profit_pct >= 2.0:
            # Move to breakeven
            if trade.stop_loss is None or trade.stop_loss < entry:
                new_sl = round(entry * 1.001, 6)  # slightly above entry
                reason = f"Breakeven stop {profit_pct:.1f}% winst → SL=${new_sl:.4f}"

        if new_sl is None:
            return

        try:
            async with AsyncSessionLocal() as db:
                result = await db.execute(select(Trade).where(Trade.id == trade.id))
                db_trade = result.scalar_one_or_none()
                if db_trade and db_trade.status == "open":
                    old_sl = db_trade.stop_loss
                    db_trade.stop_loss = new_sl
                    db.add(AuditLog(
                        action="trailing_stop_updated",
                        actor="position_monitor",
                        entity_type="trade",
                        entity_id=trade.id,
                        details={"symbol": trade.symbol, "old_sl": old_sl, "new_sl": new_sl, "profit_pct": profit_pct},
                        status="success",
                        message=f"{trade.symbol}: {reason}",
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))
                    await db.commit()
                    logger.info(f"Trailing stop bijgewerkt: {trade.symbol} {reason}")
        except Exception as e:
            logger.warning(f"Trailing stop update fout voor {trade.symbol}: {e}")

    def _is_triggered(self, trade: Trade, price: float) -> tuple[bool, str, float]:
        is_long = trade.side.lower() in ("buy", "long")

        if is_long:
            if trade.stop_loss and price <= trade.stop_loss:
                return True, f"Stop-loss geraakt @ ${price:.4f} (SL=${trade.stop_loss:.4f})", trade.stop_loss
            if trade.take_profit and price >= trade.take_profit:
                return True, f"Take-profit geraakt @ ${price:.4f} (TP=${trade.take_profit:.4f})", trade.take_profit
        else:
            if trade.stop_loss and price >= trade.stop_loss:
                return True, f"Stop-loss geraakt @ ${price:.4f} (SL={trade.stop_loss:.4f})", trade.stop_loss
            if trade.take_profit and price <= trade.take_profit:
                return True, f"Take-profit geraakt @ ${price:.4f} (TP={trade.take_profit:.4f})", trade.take_profit

        return False, "", price

    async def _execute_close(self, trade: Trade, exit_price: float, reason: str) -> None:
        # Try to close via Alpaca for real orders; fall through to DB-only for simulated
        broker_closed = False
        if trade.alpaca_order_id and self.broker._configured:
            try:
                await self.broker.close_position(trade.symbol)
                broker_closed = True
                logger.info(f"Alpaca positie gesloten: {trade.symbol} — {reason}")
            except (AlpacaNotConfiguredError, AlpacaAPIError) as e:
                logger.warning(f"Alpaca positie sluiten mislukt ({trade.symbol}): {e} — P&L berekend lokaal")

        is_long = trade.side.lower() in ("buy", "long")
        entry = trade.entry_price or exit_price
        qty = trade.quantity or 1

        if is_long:
            pnl = (exit_price - entry) * qty
        else:
            pnl = (entry - exit_price) * qty

        pnl_pct = ((exit_price - entry) / entry * 100) if entry else 0
        if not is_long:
            pnl_pct = -pnl_pct

        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Trade).where(Trade.id == trade.id))
            db_trade = result.scalar_one_or_none()
            if not db_trade or db_trade.status != "open":
                return

            db_trade.status = "closed"
            db_trade.exit_price = exit_price
            db_trade.pnl = round(pnl, 4)
            db_trade.pnl_pct = round(pnl_pct, 4)
            db_trade.closed_at = now
            db_trade.exit_reason = reason

            pnl_sign = "+" if pnl >= 0 else ""
            db.add(AuditLog(
                action="position_auto_closed",
                actor="position_monitor",
                entity_type="trade",
                entity_id=trade.id,
                details={"symbol": trade.symbol, "reason": reason, "pnl": pnl, "exit_price": exit_price, "broker_closed": broker_closed},
                status="success",
                message=f"{trade.symbol}: {reason} P&L={pnl_sign}${pnl:.2f} ({pnl_sign}{pnl_pct:.2f}%)",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()

            pnl_label = f"{pnl_sign}${abs(pnl):.2f}"
            await NotificationService(db).send(
                "position_closed",
                f"Trading OS — {trade.symbol} {'✅ TP' if 'Take-profit' in reason else '🛑 SL'} geraakt",
                f"{reason}. P&L: {pnl_label} ({pnl_sign}{pnl_pct:.2f}%)",
                severity="warning" if pnl >= 0 else "critical",
                entity_type="trade",
                entity_id=trade.id,
            )

        logger.info(f"Trade gesloten: {trade.symbol} {reason} P&L=${pnl:.2f}")

        # Write AI reflection + memory lesson for closed trade
        try:
            from app.services.trade_tracker import TradeTrackerService
            tracker = TradeTrackerService()
            trade_data = {
                "id": trade.id,
                "symbol": trade.symbol,
                "side": trade.side,
                "entry_price": entry,
                "exit_price": exit_price,
                "pnl": round(pnl, 4),
                "pnl_pct": round(pnl_pct, 4),
                "quantity": qty,
                "entry_reason": trade.entry_reason or "",
                "opened_at": trade.opened_at,
                "closed_at": now,
            }
            await tracker._write_reflection(trade_data)
        except Exception as e:
            logger.warning(f"Reflectie schrijven mislukt voor {trade.symbol}: {e}")

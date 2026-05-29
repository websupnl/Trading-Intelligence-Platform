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

    MAX_HOLD_HOURS = 72  # sluit altijd na 72u als SL/TP niet bereikt werd

    async def _check_and_close(self, trade: Trade) -> bool:
        price = await self.market.get_latest_price(trade.symbol)
        if price is None:
            return False

        # SL/TP check
        if trade.stop_loss or trade.take_profit:
            triggered, reason, exit_price = self._is_triggered(trade, price)
            if triggered:
                await self._execute_close(trade, exit_price, reason)
                return True

        # Max hold time: sluit altijd na MAX_HOLD_HOURS als er geen exit is geraakt
        if trade.opened_at:
            age = datetime.now(timezone.utc) - trade.opened_at
            if age > timedelta(hours=self.MAX_HOLD_HOURS):
                reason = f"Max hold tijd ({self.MAX_HOLD_HOURS}u) bereikt @ ${price:.4f}"
                await self._execute_close(trade, price, reason)
                return True

        return False

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

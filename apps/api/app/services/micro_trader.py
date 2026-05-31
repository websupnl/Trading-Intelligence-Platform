"""
Micro trading service — pure rule-based, no AI, runs every 20 seconds.

Three setups on 15-minute candles:
  BOUNCE    — RSI < 38 + price at EMA20 → TP +1.5%, SL -0.6%, max 20 min
  BREAKOUT  — Price crosses EMA20 upward + volume spike + RSI 42-62 → TP +1.8%, SL -0.7%, max 25 min
  SQUEEZE   — Bollinger squeeze opens upward + RSI 45-60 → TP +2.0%, SL -0.8%, max 30 min

Trades are stored with mode="micro" and managed by a dedicated fast monitor task.
"""

import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, func

from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.alpaca_broker import AlpacaBroker, AlpacaAPIError, AlpacaNotConfiguredError
from app.services.market_data_service import MarketDataService
from app.services.runtime_state import get_runtime_value
from app.services.technical_analysis import analyze as ta_analyze
from app.services.notifications import NotificationService

logger = logging.getLogger(__name__)

MICRO_ASSETS = ["BTC", "ETH", "SOL", "DOGE", "AVAX", "LINK"]
MICRO_POSITION_PCT = 0.05          # 5% of equity per micro trade
MICRO_MAX_POSITIONS = 4            # max simultaneous micro trades
MICRO_MAX_DAILY_LOSS_PCT = 0.03    # 3% of equity → pause micro trader for the day
MICRO_MODE = "micro"

SETUPS = {
    "BOUNCE":    {"tp_pct": 1.5,  "sl_pct": 0.6,  "max_hold_min": 20},
    "BREAKOUT":  {"tp_pct": 1.8,  "sl_pct": 0.7,  "max_hold_min": 25},
    "SQUEEZE":   {"tp_pct": 2.0,  "sl_pct": 0.8,  "max_hold_min": 30},
}


class MicroTraderService:
    def __init__(self):
        self.settings = get_settings()
        self.broker = AlpacaBroker()
        self.market = MarketDataService()

    async def run_cycle(self) -> int:
        """Scan all micro assets for setups and execute if criteria are met."""
        if not get_runtime_value("micro_trading_enabled", getattr(self.settings, "micro_trading_enabled", False)):
            return 0
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            return 0
        if get_runtime_value("trading_mode", self.settings.trading_mode) not in ("paper", "live"):
            return 0
        if await self._daily_micro_loss_exceeded():
            return 0

        open_count = await self._open_micro_count()
        if open_count >= MICRO_MAX_POSITIONS:
            return 0

        equity = await self._get_equity()
        if equity <= 0:
            return 0

        notional = round(equity * MICRO_POSITION_PCT, 2)
        if notional < 10.0:
            return 0

        executed = 0
        for asset in MICRO_ASSETS:
            if open_count + executed >= MICRO_MAX_POSITIONS:
                break
            if await self._has_open_micro_trade(asset):
                continue
            try:
                setup = await self._detect_setup(asset)
                if not setup:
                    continue
                ok = await self._execute_micro_trade(asset, setup, notional)
                if ok:
                    executed += 1
            except Exception as e:
                logger.error(f"Micro trade fout voor {asset}: {e}")

        return executed

    async def _detect_setup(self, asset: str) -> dict | None:
        """Return setup dict if a valid micro setup is detected, else None."""
        candles = await self.market.get_candles(asset, "15Min", 60)
        if len(candles) < 20:
            return None

        ta = ta_analyze(candles)
        if not ta or ta.rsi is None:
            return None

        price = candles[-1].close
        if not price or price <= 0:
            return None

        # Volume ratio: current vs average of last 20 candles
        volumes = [float(c.volume) for c in candles[-21:] if c.volume]
        vol_avg = sum(volumes[:-1]) / max(len(volumes) - 1, 1) if len(volumes) > 1 else 0
        vol_ratio = float(candles[-1].volume or 0) / vol_avg if vol_avg > 0 else 1.0

        ema20 = ta.ema20
        prev_close = candles[-2].close if len(candles) >= 2 else price
        rsi = ta.rsi

        # BOUNCE: RSI oversold, price near EMA20 support
        if rsi < 38 and ema20 and abs(price - ema20) / ema20 < 0.008:
            return {"setup": "BOUNCE", "price": price, **SETUPS["BOUNCE"]}

        # BREAKOUT: price crosses above EMA20 with volume spike
        if (ema20 and prev_close < ema20 <= price and
                42 <= rsi <= 62 and vol_ratio >= 1.4):
            return {"setup": "BREAKOUT", "price": price, **SETUPS["BREAKOUT"]}

        # SQUEEZE: Bollinger squeeze releasing upward
        if (ta.bb_squeeze and ta.bb_pct is not None and ta.bb_pct > 0.55 and
                45 <= rsi <= 60):
            return {"setup": "SQUEEZE", "price": price, **SETUPS["SQUEEZE"]}

        return None

    async def _execute_micro_trade(self, asset: str, setup: dict, notional: float) -> bool:
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)
        price = setup["price"]
        tp = round(price * (1 + setup["tp_pct"] / 100), 6)
        sl = round(price * (1 - setup["sl_pct"] / 100), 6)

        try:
            order = await self.broker.submit_order(
                symbol=asset,
                qty=None,
                notional=round(notional, 2),
                side="buy",
            )
        except (AlpacaNotConfiguredError, AlpacaAPIError) as e:
            logger.warning(f"Micro trade order mislukt voor {asset}: {e}")
            return False

        fill_qty = float(order.get("filled_qty") or order.get("qty") or 0)
        if fill_qty == 0 and notional and price:
            fill_qty = round(notional / price, 8)

        now = datetime.now(timezone.utc)
        trade = Trade(
            symbol=asset,
            side="buy",
            quantity=fill_qty,
            entry_price=float(order.get("filled_avg_price") or 0) or price,
            stop_loss=sl,
            take_profit=tp,
            mode=MICRO_MODE,
            status="open",
            entry_reason=f"Micro {setup['setup']}: RSI/EMA20/Volume setup",
            opened_at=now,
            alpaca_order_id=order.get("id"),
        )

        async with AsyncSessionLocal() as db:
            db.add(trade)
            db.add(AuditLog(
                action="micro_trade_executed",
                actor="micro_trader",
                entity_type="trade",
                status="success",
                details={
                    "asset": asset,
                    "setup": setup["setup"],
                    "notional": notional,
                    "price": price,
                    "tp": tp,
                    "sl": sl,
                    "mode": mode,
                },
                message=f"Micro {mode}: {asset} {setup['setup']} @ ${price:.4f} | TP=${tp:.4f} SL=${sl:.4f}",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()

        logger.info(f"Micro trade: {asset} {setup['setup']} notional=${notional:.2f} TP={tp:.4f} SL={sl:.4f}")
        return True

    async def run_micro_monitor(self) -> int:
        """Fast monitor for micro trades — checks SL/TP and max hold time. Runs every 10 seconds."""
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            return 0

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade).where(Trade.status == "open", Trade.mode == MICRO_MODE)
            )
            trades = result.scalars().all()

        if not trades:
            return 0

        symbols = list({t.symbol for t in trades})
        prices = await self.market.get_latest_prices_batch(symbols)

        closed = 0
        for trade in trades:
            price = prices.get(trade.symbol)
            if not price:
                continue
            try:
                if await self._check_micro_close(trade, price):
                    closed += 1
            except Exception as e:
                logger.error(f"Micro monitor fout {trade.symbol}: {e}")
        return closed

    async def _check_micro_close(self, trade: Trade, price: float) -> bool:
        entry = trade.entry_price or price
        reason = None

        if trade.stop_loss and price <= trade.stop_loss:
            reason = f"Micro SL geraakt @ ${price:.4f}"
        elif trade.take_profit and price >= trade.take_profit:
            reason = f"Micro TP geraakt @ ${price:.4f}"
        elif trade.opened_at:
            setup_name = (trade.entry_reason or "").split("setup")[0].split()[-1] if trade.entry_reason else "BOUNCE"
            max_min = SETUPS.get(setup_name, SETUPS["BOUNCE"])["max_hold_min"]
            age = datetime.now(timezone.utc) - trade.opened_at
            if age > timedelta(minutes=max_min):
                reason = f"Micro max hold {max_min}min bereikt @ ${price:.4f}"

        if not reason:
            return False

        qty = trade.quantity or 1.0
        pnl = (price - entry) * qty
        pnl_pct = (price - entry) / entry * 100 if entry else 0
        now = datetime.now(timezone.utc)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Trade).where(Trade.id == trade.id))
            db_trade = result.scalar_one_or_none()
            if not db_trade or db_trade.status != "open":
                return False

            # Close via broker for real orders
            if trade.alpaca_order_id and self.broker._configured:
                try:
                    from app.services.alpaca_broker import to_alpaca_symbol
                    await self.broker.close_position(to_alpaca_symbol(trade.symbol))
                except Exception as e:
                    logger.warning(f"Micro broker close mislukt {trade.symbol}: {e}")

            db_trade.status = "closed"
            db_trade.exit_price = price
            db_trade.pnl = round(pnl, 4)
            db_trade.pnl_pct = round(pnl_pct, 4)
            db_trade.closed_at = now
            db_trade.exit_reason = reason

            sign = "+" if pnl >= 0 else ""
            db.add(AuditLog(
                action="micro_trade_closed",
                actor="micro_monitor",
                entity_type="trade",
                entity_id=trade.id,
                status="success",
                details={"symbol": trade.symbol, "pnl": pnl, "reason": reason},
                message=f"Micro gesloten: {trade.symbol} {reason} P&L={sign}${pnl:.2f} ({sign}{pnl_pct:.2f}%)",
                created_at=now,
                updated_at=now,
            ))
            await db.commit()

            await NotificationService(db).send(
                "micro_trade_closed",
                f"Micro — {trade.symbol} {'✅' if pnl >= 0 else '🛑'}",
                f"{reason}. P&L: {sign}${abs(pnl):.2f} ({sign}{pnl_pct:.2f}%)",
                severity="info" if pnl >= 0 else "warning",
                entity_type="trade",
                entity_id=trade.id,
            )

        logger.info(f"Micro trade gesloten: {trade.symbol} {reason} P&L=${pnl:.2f}")
        return True

    async def _daily_micro_loss_exceeded(self) -> bool:
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.sum(Trade.pnl)).where(
                    Trade.status == "closed",
                    Trade.mode == MICRO_MODE,
                    Trade.pnl.isnot(None),
                    Trade.closed_at >= today,
                )
            )
            daily_pnl = float(result.scalar() or 0)
        if daily_pnl >= 0:
            return False
        equity = await self._get_equity()
        if equity <= 0:
            return False
        loss_pct = abs(daily_pnl) / equity
        if loss_pct >= MICRO_MAX_DAILY_LOSS_PCT:
            logger.warning(f"Micro dagelijks verlies {loss_pct:.1%} — micro trader gepauzeerd voor vandaag")
            return True
        return False

    async def _get_equity(self) -> float:
        try:
            account = await self.broker.get_account()
            return float(account.get("equity") or account.get("portfolio_value") or 0)
        except Exception:
            return 0.0

    async def _open_micro_count(self) -> int:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(func.count()).where(Trade.status == "open", Trade.mode == MICRO_MODE)
            )
            return int(result.scalar() or 0)

    async def _has_open_micro_trade(self, asset: str) -> bool:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade).where(
                    Trade.symbol == asset,
                    Trade.status == "open",
                    Trade.mode == MICRO_MODE,
                ).limit(1)
            )
            return result.scalar_one_or_none() is not None

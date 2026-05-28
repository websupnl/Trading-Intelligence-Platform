import logging
from datetime import datetime, timezone
from sqlalchemy import select, func
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.signals import Signal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.risk_engine import RiskEngine
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
from app.schemas.risk import RiskCheckRequest
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.order_recorder import record_submitted_order
from app.services.notifications import NotificationService

logger = logging.getLogger(__name__)

AUTO_TRADE_CONFIDENCE_THRESHOLD = 0.60
MAX_AUTO_NOTIONAL = 500.0
MIN_NOTIONAL = 50.0


class AutoTraderService:
    def __init__(self):
        self.settings = get_settings()
        self.risk_engine = RiskEngine()
        self.broker = AlpacaBroker()

    async def process_pending_signals(self) -> int:
        """Auto-trade high-confidence signals. Returns count traded."""
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            logger.info("Kill switch actief - auto trader gestopt")
            return 0
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)
        if mode not in ("paper", "live"):
            logger.info("Ongeldig trading_mode - auto trader gestopt")
            return 0
        if get_runtime_value("require_manual_confirmation", self.settings.require_manual_confirmation):
            logger.info("Handmatige bevestiging vereist - auto trader gestopt")
            return 0

        # Daily loss circuit breaker check
        if await self._daily_loss_triggered(mode):
            return 0

        now = datetime.now(timezone.utc)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Signal).where(
                    Signal.status.in_(["pending", "broker_error"]),
                    Signal.confidence >= AUTO_TRADE_CONFIDENCE_THRESHOLD,
                    Signal.expires_at > now,
                ).order_by(Signal.confidence.desc()).limit(10)
            )
            signals = result.scalars().all()

        if not signals:
            return 0

        notional = await self._get_notional()
        executed = 0
        for signal in signals:
            try:
                result = await self._execute_signal(signal, notional)
                if result:
                    executed += 1
            except Exception as e:
                logger.error(f"Auto trade fout voor {signal.asset}: {e}")

        return executed

    async def _daily_loss_triggered(self, mode: str) -> bool:
        """Check daily P&L against circuit breaker threshold. Enables kill switch if exceeded."""
        try:
            today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(func.sum(Trade.pnl)).where(
                        Trade.status == "closed",
                        Trade.mode == mode,
                        Trade.pnl.isnot(None),
                        Trade.closed_at >= today,
                    )
                )
                daily_pnl = float(result.scalar() or 0)

            if daily_pnl >= 0:
                return False

            # Get account equity for percentage calculation
            equity = await self._get_equity()
            if equity <= 0:
                return False

            loss_pct = abs(daily_pnl) / equity
            max_loss = get_runtime_value("max_daily_loss_pct", self.settings.max_daily_loss_pct)

            if loss_pct >= max_loss:
                set_runtime_value("kill_switch_enabled", True)
                logger.warning(
                    f"Dagelijks verlies circuit breaker: verlies={loss_pct:.1%} > max={max_loss:.1%}. "
                    "Kill switch ingeschakeld."
                )
                async with AsyncSessionLocal() as db:
                    db.add(AuditLog(
                        action="circuit_breaker_triggered",
                        actor="auto_trader",
                        details={"daily_pnl": daily_pnl, "equity": equity, "loss_pct": loss_pct},
                        status="error",
                        message=f"Dagelijks verlies {loss_pct:.1%} overschrijdt limiet {max_loss:.1%}. Kill switch aan.",
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))
                    await db.commit()
                return True

        except Exception as e:
            logger.error(f"Daily loss check fout: {e}")

        return False

    async def _get_equity(self) -> float:
        """Get account equity from Alpaca, fallback to 10k."""
        try:
            account = await self.broker.get_account()
            equity = float(account.get("equity") or account.get("portfolio_value") or 0)
            return equity if equity > 0 else 10_000.0
        except Exception:
            return 10_000.0

    async def _get_notional(self) -> float:
        """Equity-based position sizing: position_size_pct % of account, capped at 5x MAX_AUTO_NOTIONAL."""
        try:
            equity = await self._get_equity()
            pct = get_runtime_value("position_size_pct", self.settings.position_size_pct)
            notional = equity * pct
            return round(max(MIN_NOTIONAL, min(notional, MAX_AUTO_NOTIONAL * 5)), 2)
        except Exception:
            return MAX_AUTO_NOTIONAL

    async def _get_broker_exposure(self, symbol: str) -> float | None:
        """Return signed broker quantity if a position exists; positive=long, negative=short."""
        try:
            positions = await self.broker.get_positions()
            for pos in positions:
                if (pos.get("symbol") or "").upper() == symbol.upper():
                    return float(pos.get("qty") or 0)
        except Exception as exc:
            logger.warning(f"Broker exposure check overgeslagen voor {symbol}: {exc}")
        return None

    async def _skip_signal(self, signal: Signal, status: str, message: str) -> None:
        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Signal).where(Signal.id == signal.id))
            db_signal = result.scalar_one_or_none()
            if not db_signal:
                return
            db_signal.status = status
            db.add(AuditLog(
                action=status,
                actor="auto_trader",
                entity_type="signal",
                entity_id=signal.id,
                details={"asset": signal.asset, "direction": signal.direction},
                status="skipped",
                message=message,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ))
            await db.commit()

    async def _execute_signal(self, signal: Signal, notional: float) -> bool:
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)

        exposure = await self._get_broker_exposure(signal.asset)
        if exposure:
            current_side = "buy" if exposure > 0 else "sell"
            if current_side == signal.direction:
                await self._skip_signal(
                    signal,
                    "skipped_existing",
                    f"{signal.asset}: bestaande {current_side} exposure ({exposure}) - signaal niet gestapeld",
                )
                return False
            await self._skip_signal(
                signal,
                "skipped_conflict",
                f"{signal.asset}: bestaande {current_side} exposure ({exposure}) conflicteert met {signal.direction} signaal",
            )
            return False

        risk_req = RiskCheckRequest(
            symbol=signal.asset,
            side=signal.direction,
            quantity=None,
            confidence=signal.confidence,
            stop_loss=signal.suggested_stop,
            mode=mode,
            estimated_notional=notional,
        )
        risk_result = self.risk_engine.check(risk_req)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Signal).where(Signal.id == signal.id))
            db_signal = result.scalar_one_or_none()
            if not db_signal:
                return False

            if not risk_result.approved or risk_result.required_manual_approval:
                db_signal.status = "risk_rejected" if not risk_result.approved else "pending"
                db_signal.risk_check_result = risk_result.model_dump()

                db.add(AuditLog(
                    action="auto_trade_risk_rejected" if not risk_result.approved else "auto_trade_manual_required",
                    actor="auto_trader",
                    entity_type="signal",
                    entity_id=signal.id,
                    details={"asset": signal.asset, "reasons": risk_result.reasons, "warnings": risk_result.warnings, "confidence": signal.confidence},
                    status="rejected" if not risk_result.approved else "pending",
                    message=f"{signal.asset}: {'; '.join((risk_result.reasons or risk_result.warnings)[:2])}",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))
                await db.commit()
                logger.info(f"Auto trade geweigerd door risk: {signal.asset} — {risk_result.reasons}")
                return False

            order_qty = None
            order_notional = round(float(notional), 2)
            if signal.direction == "sell" and signal.suggested_entry:
                # Alpaca rejects fractional short sells. Use whole-share qty for sell/short signals.
                order_qty = max(1, int(order_notional / float(signal.suggested_entry)))
                order_notional = None

            try:
                order = await self.broker.submit_order(
                    symbol=signal.asset,
                    qty=order_qty,
                    notional=order_notional,
                    side=signal.direction,
                    stop_price=signal.suggested_stop,
                    take_profit_price=signal.suggested_take_profit,
                )
                status_label = "paper_traded" if mode == "paper" else "live_traded"
                db_signal.status = status_label
                db_signal.risk_check_result = risk_result.model_dump()

                alpaca_id = order.get("id") if isinstance(order, dict) else None
                fill_price = None
                if isinstance(order, dict):
                    fill_price = float(order.get("filled_avg_price") or order.get("limit_price") or 0) or None

                fill_qty = float(order.get("qty") or 0) if isinstance(order, dict) else 0
                trade = Trade(
                    signal_id=signal.id,
                    alpaca_order_id=alpaca_id,
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=fill_qty or order_qty or notional,
                    entry_price=fill_price or signal.suggested_entry,
                    stop_loss=signal.suggested_stop,
                    take_profit=signal.suggested_take_profit,
                    mode=mode,
                    status="open",
                    entry_reason=signal.reason[:500] if signal.reason else "Auto-trader signaal",
                    opened_at=datetime.now(timezone.utc),
                )
                local_order = record_submitted_order(
                    db,
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=order_qty,
                    notional=order_notional,
                    order_type="market",
                    mode=mode,
                    broker_response=order,
                    signal_id=signal.id,
                    stop_price=signal.suggested_stop,
                    risk_check_result=risk_result.model_dump(),
                )
                trade.order_id = local_order.id
                db.add(trade)

                db.add(AuditLog(
                    action="auto_trade_executed",
                    actor="auto_trader",
                    entity_type="signal",
                    entity_id=signal.id,
                    details={
                        "asset": signal.asset,
                        "direction": signal.direction,
                        "confidence": signal.confidence,
                        "mode": mode,
                        "notional": notional,
                        "alpaca_order_id": alpaca_id,
                        "bull_score": signal.ai_analysis.get("bull_score") if signal.ai_analysis else None,
                        "bear_score": signal.ai_analysis.get("bear_score") if signal.ai_analysis else None,
                    },
                    status="success",
                    message=f"{'📄 Paper' if mode == 'paper' else '💰 Live'} trade: {signal.asset} {signal.direction} @ ${notional:.0f} | confidence {signal.confidence:.0%}",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))

                await db.commit()
                await NotificationService(db).send(
                    "auto_trade_executed",
                    f"Trading OS - Auto {mode} trade: {signal.asset} {signal.direction.upper()}",
                    f"Notional: ${notional:.0f} | Confidence: {signal.confidence:.0%} | SL: {signal.suggested_stop} | TP: {signal.suggested_take_profit}",
                    severity="warning" if mode == "paper" else "critical",
                    entity_type="signal",
                    entity_id=signal.id,
                )
                logger.info(f"Auto {mode} trade uitgevoerd: {signal.asset} {signal.direction} ${notional:.0f}")
                return True

            except AlpacaNotConfiguredError:
                db_signal.status = "broker_error"
                db.add(AuditLog(
                    action="auto_trade_broker_error",
                    actor="auto_trader",
                    entity_type="signal",
                    entity_id=signal.id,
                    status="error",
                    message="Alpaca niet geconfigureerd",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))
                await db.commit()
                return False
            except AlpacaAPIError as e:
                logger.error(f"Broker fout voor {signal.asset}: {e}")
                db_signal.status = "broker_error"
                db.add(AuditLog(
                    action="auto_trade_broker_error",
                    actor="auto_trader",
                    entity_type="signal",
                    entity_id=signal.id,
                    status="error",
                    message=str(e)[:500],
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))
                await db.commit()
                await NotificationService(db).send(
                    "auto_trade_broker_error",
                    f"Trading OS - Auto-trade broker fout: {signal.asset} {signal.direction.upper()}",
                    str(e)[:1200],
                    severity="error",
                    entity_type="signal",
                    entity_id=signal.id,
                )
                return False

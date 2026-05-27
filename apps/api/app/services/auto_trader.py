import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.signals import Signal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.risk_engine import RiskEngine
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
from app.schemas.risk import RiskCheckRequest
from app.services.runtime_state import get_runtime_value
from app.services.order_recorder import record_submitted_order

logger = logging.getLogger(__name__)

AUTO_TRADE_CONFIDENCE_THRESHOLD = 0.78
MAX_AUTO_NOTIONAL = 500.0


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

        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Signal).where(
                    Signal.status == "pending",
                    Signal.confidence >= AUTO_TRADE_CONFIDENCE_THRESHOLD,
                ).order_by(Signal.confidence.desc()).limit(5)
            )
            signals = result.scalars().all()

        if not signals:
            return 0

        executed = 0
        for signal in signals:
            try:
                result = await self._execute_signal(signal)
                if result:
                    executed += 1
            except Exception as e:
                logger.error(f"Auto trade fout voor {signal.asset}: {e}")

        return executed

    async def _execute_signal(self, signal: Signal) -> bool:
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)  # "paper" or "live"

        risk_req = RiskCheckRequest(
            symbol=signal.asset,
            side=signal.direction,
            quantity=1,
            confidence=signal.confidence,
            stop_loss=signal.suggested_stop,
            mode=mode,
            estimated_notional=MAX_AUTO_NOTIONAL,
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

            try:
                order = await self.broker.submit_order(
                    symbol=signal.asset,
                    qty=1,
                    notional=None,
                    side=signal.direction,
                    stop_price=signal.suggested_stop,
                )
                status_label = "paper_traded" if mode == "paper" else "live_traded"
                db_signal.status = status_label
                db_signal.risk_check_result = risk_result.model_dump()

                # Create Trade record
                alpaca_id = order.get("id") if isinstance(order, dict) else None
                fill_price = None
                if isinstance(order, dict):
                    fill_price = float(order.get("filled_avg_price") or order.get("limit_price") or 0) or None

                trade = Trade(
                    signal_id=signal.id,
                    alpaca_order_id=alpaca_id,
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=1,
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
                    quantity=1,
                    notional=None,
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
                        "alpaca_order_id": alpaca_id,
                        "bull_score": signal.ai_analysis.get("bull_score") if signal.ai_analysis else None,
                        "bear_score": signal.ai_analysis.get("bear_score") if signal.ai_analysis else None,
                    },
                    status="success",
                    message=f"{'📄 Paper' if mode == 'paper' else '💰 Live'} trade: {signal.asset} {signal.direction} @ confidence {signal.confidence:.0%}",
                    created_at=datetime.now(timezone.utc),
                    updated_at=datetime.now(timezone.utc),
                ))

                await db.commit()
                logger.info(f"Auto {mode} trade uitgevoerd: {signal.asset} {signal.direction}")
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
                return False

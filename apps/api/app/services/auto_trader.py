import logging
from datetime import datetime, timezone
from sqlalchemy import select, func
from app.config import get_settings
from app.database import AsyncSessionLocal
from app.models.signals import Signal
from app.models.trades import Trade
from app.models.audit import AuditLog
from app.services.risk_engine import RiskEngine
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError, CRYPTO_SYMBOLS
from app.schemas.risk import RiskCheckRequest
from app.services.runtime_state import get_runtime_value, set_runtime_value
from app.services.order_recorder import record_submitted_order
from app.services.notifications import NotificationService
from app.services.crypto_session import crypto_session_allows_autonomy, get_crypto_session, is_crypto_24_7_enabled, stop_crypto_session

logger = logging.getLogger(__name__)

AUTO_TRADE_CONFIDENCE_THRESHOLD = 0.60
CRYPTO_SESSION_CONFIDENCE_THRESHOLD = 0.50
MAX_AUTO_NOTIONAL = 500.0
MIN_VIABLE_NOTIONAL = 1.0


class AutoTraderService:
    def __init__(self):
        self.settings = get_settings()
        self.risk_engine = RiskEngine()
        self.broker = AlpacaBroker()

    async def process_pending_signals(self, crypto_only: bool = False) -> int:
        """Auto-trade high-confidence signals. Returns count traded.
        crypto_only=True filters to crypto assets (for outside US market hours)."""
        crypto_session = get_crypto_session()
        session_autonomy = crypto_session_allows_autonomy()
        crypto_24_7 = is_crypto_24_7_enabled()
        autonomous = session_autonomy or crypto_24_7
        if autonomous:
            crypto_only = True
        if get_runtime_value("kill_switch_enabled", self.settings.kill_switch_enabled):
            logger.info("Kill switch actief - auto trader gestopt")
            return 0
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)
        if mode not in ("paper", "live"):
            logger.info("Ongeldig trading_mode - auto trader gestopt")
            return 0
        if not autonomous:
            from app.services.market_session import us_market_open as _market_open
            if _market_open():
                # Market open but no session/24/7 active — wait for explicit permission
                if crypto_only:
                    logger.info("Crypto auto trader wacht op sessie of 24/7 modus (markt open)")
                    return 0
            else:
                # Market closed: crypto is inherently 24/7, no session needed
                autonomous = True
                crypto_only = True
        if get_runtime_value("require_manual_confirmation", self.settings.require_manual_confirmation) and not autonomous:
            logger.info("Handmatige bevestiging vereist - auto trader gestopt")
            return 0

        # Daily loss circuit breaker check
        if await self._daily_loss_triggered(mode):
            return 0

        # Session budget auto-stop
        if session_autonomy and not crypto_24_7:
            if await self._session_budget_exceeded(crypto_session):
                return 0

        now = datetime.now(timezone.utc)
        remaining_session_trades = None
        # Session trade limits only apply to timed sessions, not 24/7 mode
        if session_autonomy and not crypto_24_7:
            started_at = crypto_session.get("started_at")
            try:
                session_start = datetime.fromisoformat(started_at) if started_at else now
            except ValueError:
                session_start = now
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(func.count()).where(
                        Trade.opened_at >= session_start,
                        Trade.symbol.in_(CRYPTO_SYMBOLS),
                    )
                )
                used = int(result.scalar() or 0)
            remaining_session_trades = max(0, int(crypto_session.get("max_trades") or 0) - used)
            if remaining_session_trades <= 0:
                logger.info("Crypto sessie trade-limiet bereikt")
                return 0

        async with AsyncSessionLocal() as db:
            threshold = CRYPTO_SESSION_CONFIDENCE_THRESHOLD if autonomous else AUTO_TRADE_CONFIDENCE_THRESHOLD
            # broker_error = transient API failure → retry; skipped_funds = niet genoeg saldo → niet retrien
            query = select(Signal).where(
                Signal.status.in_(["pending", "broker_error"]),
                Signal.confidence >= threshold,
                Signal.expires_at > now,
            )
            if crypto_only:
                query = query.where(Signal.asset.in_(CRYPTO_SYMBOLS))
            result = await db.execute(
                query.order_by(Signal.confidence.desc()).limit(remaining_session_trades or 10)
            )
            signals = result.scalars().all()

        if not signals:
            return 0

        notional = await self._get_notional()
        if notional < MIN_VIABLE_NOTIONAL:
            logger.warning(f"Berekende notional ${notional:.2f} is te laag voor een order — auto trader gestopt")
            return 0

        executed = 0
        for signal in signals:
            try:
                session_cap = float(crypto_session.get("max_notional_per_trade") or notional) if session_autonomy and not crypto_24_7 else notional
                result = await self._execute_signal(
                    signal,
                    min(notional, session_cap),
                    session_autonomy=autonomous,
                )
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

    async def _session_budget_exceeded(self, session: dict) -> bool:
        """Stop session automatically if realized P&L loss exceeds stop_loss_pct of session_budget."""
        try:
            session_budget = float(session.get("session_budget") or 0)
            stop_loss_pct = float(session.get("stop_loss_pct") or 0.20)
            if session_budget <= 0:
                return False
            started_at = session.get("started_at")
            if not started_at:
                return False
            session_start = datetime.fromisoformat(str(started_at))
            async with AsyncSessionLocal() as db:
                result = await db.execute(
                    select(func.sum(Trade.pnl)).where(
                        Trade.status == "closed",
                        Trade.pnl.isnot(None),
                        Trade.symbol.in_(CRYPTO_SYMBOLS),
                        Trade.opened_at >= session_start,
                    )
                )
                realized_pnl = float(result.scalar() or 0)
            max_loss = -(session_budget * stop_loss_pct)
            if realized_pnl <= max_loss:
                stop_crypto_session("budget_exceeded")
                logger.warning(
                    f"Sessie budget auto-stop: P&L ${realized_pnl:.2f} ≤ limiet ${max_loss:.2f} "
                    f"({stop_loss_pct:.0%} van ${session_budget:.0f})"
                )
                async with AsyncSessionLocal() as db:
                    db.add(AuditLog(
                        action="crypto_session_budget_exceeded",
                        actor="auto_trader",
                        details={"realized_pnl": realized_pnl, "session_budget": session_budget, "max_loss": max_loss},
                        status="warning",
                        message=f"Sessie gestopt: verlies ${abs(realized_pnl):.2f} overschrijdt {stop_loss_pct:.0%} van budget ${session_budget:.0f}",
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))
                    await db.commit()
                return True
        except Exception as e:
            logger.error(f"Session budget check fout: {e}")
        return False

    async def _get_equity(self) -> float:
        """Get account equity from Alpaca. Returns 0.0 on failure so sizing fails safe."""
        try:
            account = await self.broker.get_account()
            equity = float(account.get("equity") or account.get("portfolio_value") or 0)
            return equity if equity > 0 else 0.0
        except Exception:
            return 0.0

    async def _get_buying_power(self) -> float:
        """Return available buying power (cash not tied up in open positions)."""
        try:
            account = await self.broker.get_account()
            bp = float(account.get("buying_power") or account.get("cash") or 0)
            return bp if bp > 0 else 0.0
        except Exception:
            return 0.0

    async def _get_notional(self) -> float:
        """Equity-based position sizing: position_size_pct % of account, hard-capped at MAX_AUTO_NOTIONAL."""
        try:
            equity = await self._get_equity()
            if equity <= 0:
                return 0.0
            pct = get_runtime_value("position_size_pct", self.settings.position_size_pct)
            notional = round(equity * pct, 2)
            return min(notional, MAX_AUTO_NOTIONAL)
        except Exception:
            return 0.0

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

    async def _execute_signal(self, signal: Signal, notional: float, session_autonomy: bool = False) -> bool:
        mode = get_runtime_value("trading_mode", self.settings.trading_mode)

        exposure = await self._get_broker_exposure(signal.asset)
        is_closing = signal.direction == "sell"

        if is_closing:
            # SELL: alleen toegestaan om een bestaande long te sluiten
            if not exposure or exposure <= 0:
                await self._skip_signal(
                    signal,
                    "skipped_no_position",
                    f"{signal.asset}: SELL signaal overgeslagen — geen bestaande long positie om te sluiten (long-only strategie)",
                )
                return False
            # exposure > 0: we hebben een long → doorgaan met sluiting

        elif exposure:
            # BUY: geen nieuwe positie stapelen op bestaande exposure
            current_side = "buy" if exposure > 0 else "sell"
            if current_side == "buy":
                await self._skip_signal(
                    signal,
                    "skipped_existing",
                    f"{signal.asset}: bestaande long exposure ({exposure:.4f}) — signaal niet gestapeld",
                )
            else:
                await self._skip_signal(
                    signal,
                    "skipped_conflict",
                    f"{signal.asset}: bestaande short exposure ({exposure:.4f}) conflicteert met BUY signaal",
                )
            return False

        # Pre-flight: check of er genoeg koopkracht is voor een BUY
        if not is_closing:
            buying_power = await self._get_buying_power()
            if buying_power < MIN_VIABLE_NOTIONAL:
                await self._skip_signal(
                    signal,
                    "skipped_funds",
                    f"{signal.asset}: onvoldoende koopkracht (${buying_power:.2f} beschikbaar, ${notional:.2f} nodig)",
                )
                logger.warning(f"{signal.asset}: auto trade overgeslagen — koopkracht ${buying_power:.2f} te laag")
                return False
            if buying_power < notional:
                # Schaal af naar 95% van beschikbaar saldo
                notional = round(buying_power * 0.95, 2)
                logger.info(f"{signal.asset}: notional teruggeschaald naar ${notional:.2f} (koopkracht: ${buying_power:.2f})")
                if notional < MIN_VIABLE_NOTIONAL:
                    await self._skip_signal(
                        signal,
                        "skipped_funds",
                        f"{signal.asset}: onvoldoende koopkracht na afschaling (${buying_power:.2f} beschikbaar)",
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
            is_closing_position=is_closing,
        )
        risk_result = await self.risk_engine.check_async(risk_req)

        async with AsyncSessionLocal() as db:
            result = await db.execute(select(Signal).where(Signal.id == signal.id))
            db_signal = result.scalar_one_or_none()
            if not db_signal:
                return False

            manual_allowed_by_session = session_autonomy and mode == "paper" and signal.asset in CRYPTO_SYMBOLS
            if not risk_result.approved or (risk_result.required_manual_approval and not manual_allowed_by_session):
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
            if is_closing and exposure:
                # Sluit exacte positiegrootte — gebruik broker exposure, niet notional-berekening
                order_qty = abs(exposure)
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

                # filled_qty = daadwerkelijk gevulde hoeveelheid (kan 0 zijn vlak na order)
                fill_qty = float(order.get("filled_qty") or order.get("qty") or 0) if isinstance(order, dict) else 0
                # Voor notional orders: sla coins op, niet dollars (anders toont portfolio $40k voor $20 ETH order)
                if fill_qty == 0 and order_notional and signal.suggested_entry:
                    fill_qty = round(float(order_notional) / float(signal.suggested_entry), 8)
                trade = Trade(
                    signal_id=signal.id,
                    alpaca_order_id=alpaca_id,
                    symbol=signal.asset,
                    side=signal.direction,
                    quantity=fill_qty or order_qty or order_notional,
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
                        "crypto_session": session_autonomy,
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
                err_str = str(e)
                # 40310000 = Alpaca insufficient balance code; ook plain-text check als fallback
                is_funds_error = "40310000" in err_str or "insufficient balance" in err_str.lower() or "insufficient_balance" in err_str.lower()
                if is_funds_error:
                    logger.warning(f"Onvoldoende saldo voor {signal.asset}: {e}")
                    db_signal.status = "skipped_funds"
                    db.add(AuditLog(
                        action="auto_trade_insufficient_funds",
                        actor="auto_trader",
                        entity_type="signal",
                        entity_id=signal.id,
                        status="skipped",
                        message=f"Onvoldoende saldo: {err_str[:300]}",
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))
                else:
                    logger.error(f"Broker fout voor {signal.asset}: {e}")
                    db_signal.status = "broker_error"
                    db.add(AuditLog(
                        action="auto_trade_broker_error",
                        actor="auto_trader",
                        entity_type="signal",
                        entity_id=signal.id,
                        status="error",
                        message=err_str[:500],
                        created_at=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc),
                    ))
                await db.commit()
                return False

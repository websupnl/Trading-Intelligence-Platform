import logging
from typing import Optional
from app.config import get_settings
from app.schemas.risk import RiskCheckRequest, RiskCheckResult
from app.services.runtime_state import get_runtime_value

logger = logging.getLogger(__name__)

settings = get_settings()

# Risk limits
MAX_DAILY_LOSS_PCT = 0.05
MAX_POSITION_SIZE_USD = 10000.0
MAX_OPEN_POSITIONS = 10
MAX_TRADES_PER_DAY = 20
MIN_CONFIDENCE_FOR_AUTO = 0.60
MANUAL_APPROVAL_THRESHOLD = 0.5


class RiskEngine:
    def check(self, req: RiskCheckRequest) -> RiskCheckResult:
        reasons: list[str] = []
        warnings: list[str] = []
        approved = True
        required_manual = False
        blocked_by = None

        # Kill switch
        if get_runtime_value("kill_switch_enabled", settings.kill_switch_enabled):
            reasons.append("Kill switch is actief - alle orders geblokkeerd")
            return RiskCheckResult(approved=False, required_manual_approval=False, reasons=reasons, warnings=warnings, blocked_by_rule="kill_switch")

        # Live trading lock
        if req.mode == "live" and not get_runtime_value("live_trading_enabled", settings.live_trading_enabled):
            reasons.append("Live trading is uitgeschakeld (LIVE_TRADING_ENABLED=false)")
            return RiskCheckResult(approved=False, required_manual_approval=False, reasons=reasons, warnings=warnings, blocked_by_rule="live_trading_disabled")

        # Trading mode mismatch
        if get_runtime_value("trading_mode", settings.trading_mode) == "paper" and req.mode == "live":
            reasons.append("Systeem staat in paper mode - live orders niet toegestaan")
            return RiskCheckResult(approved=False, required_manual_approval=False, reasons=reasons, warnings=warnings, blocked_by_rule="paper_mode_only")

        # Notional check
        if req.estimated_notional and req.estimated_notional > MAX_POSITION_SIZE_USD:
            reasons.append(f"Order grootte ${req.estimated_notional:.2f} overschrijdt maximum ${MAX_POSITION_SIZE_USD:.2f}")
            approved = False
            blocked_by = "max_position_size"

        # Confidence check
        if req.confidence is not None:
            if req.confidence < MANUAL_APPROVAL_THRESHOLD:
                reasons.append(f"Confidence {req.confidence:.2%} te laag (minimum {MANUAL_APPROVAL_THRESHOLD:.2%})")
                approved = False
                blocked_by = "low_confidence"
            elif req.confidence < MIN_CONFIDENCE_FOR_AUTO:
                warnings.append(f"Lage confidence {req.confidence:.2%} - handmatige bevestiging aanbevolen")
                required_manual = True

        # Manual confirmation requirement
        if get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation) and approved and not required_manual:
            required_manual = True
            warnings.append("Handmatige bevestiging vereist (REQUIRE_MANUAL_CONFIRMATION=true)")

        # Short selling check
        if req.side == "sell" and not get_runtime_value("allow_short_selling", settings.allow_short_selling):
            reasons.append("Short selling uitgeschakeld (allow_short_selling=false)")
            approved = False
            blocked_by = "short_selling_disabled"

        # Missing stop loss warning
        if req.stop_loss is None:
            warnings.append("Geen stop loss ingesteld - risico niet begrensd")

        return RiskCheckResult(
            approved=approved,
            required_manual_approval=required_manual,
            reasons=reasons,
            warnings=warnings,
            max_position_size=MAX_POSITION_SIZE_USD,
            blocked_by_rule=blocked_by,
        )

    async def get_status(self) -> dict:
        return {
            "trading_mode": get_runtime_value("trading_mode", settings.trading_mode),
            "live_trading_enabled": get_runtime_value("live_trading_enabled", settings.live_trading_enabled),
            "kill_switch_enabled": get_runtime_value("kill_switch_enabled", settings.kill_switch_enabled),
            "require_manual_confirmation": get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation),
            "max_position_size_usd": MAX_POSITION_SIZE_USD,
            "max_daily_loss_pct": MAX_DAILY_LOSS_PCT,
            "max_open_positions": MAX_OPEN_POSITIONS,
            "max_trades_per_day": MAX_TRADES_PER_DAY,
            "min_confidence_for_auto": MIN_CONFIDENCE_FOR_AUTO,
            "auto_trade_threshold": 0.60,
            "position_size_pct": get_runtime_value("position_size_pct", settings.position_size_pct),
        }

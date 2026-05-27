import logging
from typing import Optional
from app.config import get_settings
from app.schemas.risk import RiskCheckRequest, RiskCheckResult

logger = logging.getLogger(__name__)

settings = get_settings()

# Risk limits
MAX_DAILY_LOSS_PCT = 0.05
MAX_POSITION_SIZE_USD = 10000.0
MAX_OPEN_POSITIONS = 10
MAX_TRADES_PER_DAY = 20
MIN_CONFIDENCE_FOR_AUTO = 0.7
MANUAL_APPROVAL_THRESHOLD = 0.5


class RiskEngine:
    def check(self, req: RiskCheckRequest) -> RiskCheckResult:
        reasons: list[str] = []
        warnings: list[str] = []
        approved = True
        required_manual = False
        blocked_by = None

        # Kill switch
        if settings.kill_switch_enabled:
            reasons.append("Kill switch is actief - alle orders geblokkeerd")
            return RiskCheckResult(approved=False, required_manual_approval=False, reasons=reasons, warnings=warnings, blocked_by_rule="kill_switch")

        # Live trading lock
        if req.mode == "live" and not settings.live_trading_enabled:
            reasons.append("Live trading is uitgeschakeld (LIVE_TRADING_ENABLED=false)")
            return RiskCheckResult(approved=False, required_manual_approval=False, reasons=reasons, warnings=warnings, blocked_by_rule="live_trading_disabled")

        # Trading mode mismatch
        if settings.trading_mode == "paper" and req.mode == "live":
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
        if settings.require_manual_confirmation and approved and not required_manual:
            required_manual = True
            warnings.append("Handmatige bevestiging vereist (REQUIRE_MANUAL_CONFIRMATION=true)")

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

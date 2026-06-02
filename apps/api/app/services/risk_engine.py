import logging
from typing import Optional
from app.config import get_settings
from app.schemas.risk import RiskCheckRequest, RiskCheckResult
from app.services.active_rule_engine import evaluate_active_rules
from app.services.runtime_state import get_runtime_value

logger = logging.getLogger(__name__)

settings = get_settings()

# Correlation clusters: max 2 simultaneous positions per cluster
CORRELATION_CLUSTERS: dict[str, frozenset[str]] = {
    "crypto_majors":  frozenset({"BTC", "ETH", "SOL", "LTC", "BCH"}),
    "crypto_alts":    frozenset({"DOGE", "ALGO", "AVAX", "LINK", "UNI", "AAVE"}),
    "crypto_defi":    frozenset({"CRV", "SUSHI", "YFI", "MKR", "BAT", "XTZ"}),
    "tech_megacap":   frozenset({"AAPL", "MSFT", "AMZN", "GOOGL", "META"}),
    "tech_momentum":  frozenset({"NVDA", "AMD", "TSLA", "MSTR", "COIN", "PLTR"}),
}
MAX_PER_CLUSTER = 2


# Risk limits read from Redis at call time — updatable without restart
def _max_position_size_usd() -> float:
    return float(get_runtime_value("max_position_size_usd", settings.max_position_size_usd))

def _max_open_positions() -> int:
    return int(get_runtime_value("max_open_positions", settings.max_open_positions))

def _max_trades_per_day() -> int:
    return int(get_runtime_value("max_trades_per_day", settings.max_trades_per_day))

def _max_daily_loss_pct() -> float:
    return float(get_runtime_value("max_daily_loss_pct", settings.max_daily_loss_pct))

def _min_confidence_for_auto() -> float:
    return float(get_runtime_value("min_confidence_for_auto", settings.min_confidence_for_auto))

def _manual_approval_threshold() -> float:
    return float(get_runtime_value("manual_approval_threshold", settings.manual_approval_threshold))


async def _check_correlation_cluster_async(symbol: str) -> list[str]:
    """Return rejection reasons if adding this symbol would exceed the cluster position limit."""
    from sqlalchemy import select
    from app.database import AsyncSessionLocal
    from app.models.trades import Trade

    cluster_name = None
    for name, members in CORRELATION_CLUSTERS.items():
        if symbol in members:
            cluster_name = name
            break
    if not cluster_name:
        return []

    cluster_members = CORRELATION_CLUSTERS[cluster_name]
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Trade).where(
                    Trade.status == "open",
                    Trade.symbol.in_(list(cluster_members)),
                ).limit(MAX_PER_CLUSTER + 1)
            )
            count = len(result.scalars().all())
        if count >= MAX_PER_CLUSTER:
            return [f"{symbol}: cluster '{cluster_name}' heeft al {count}/{MAX_PER_CLUSTER} posities — te veel correlatie"]
    except Exception as e:
        logger.warning(f"Correlatie check fout voor {symbol}: {e}")
    return []


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

        # Per-profile position size check
        from app.services.asset_profile import get_asset_profile
        asset_profile = get_asset_profile(req.symbol) if req.symbol else None
        effective_max = asset_profile.max_notional_usd if asset_profile else _max_position_size_usd()
        if req.estimated_notional and req.estimated_notional > effective_max:
            reasons.append(
                f"Order grootte ${req.estimated_notional:.2f} overschrijdt maximum voor {asset_profile.label if asset_profile else 'onbekend'} (${effective_max:.2f})"
            )
            approved = False
            blocked_by = "max_position_size"

        # Confidence check
        if req.confidence is not None:
            manual_threshold = _manual_approval_threshold()
            auto_threshold = _min_confidence_for_auto()
            if req.confidence < manual_threshold:
                reasons.append(f"Confidence {req.confidence:.2%} te laag (minimum {manual_threshold:.2%})")
                approved = False
                blocked_by = "low_confidence"
            elif req.confidence < auto_threshold:
                warnings.append(f"Lage confidence {req.confidence:.2%} - handmatige bevestiging aanbevolen")
                required_manual = True

        # Manual confirmation requirement
        if get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation) and approved and not required_manual:
            required_manual = True
            warnings.append("Handmatige bevestiging vereist (REQUIRE_MANUAL_CONFIRMATION=true)")

        # Short selling check — skip for closing orders (selling to close a long is not short selling)
        if req.side == "sell" and not req.is_closing_position and not get_runtime_value("allow_short_selling", settings.allow_short_selling):
            reasons.append("Short selling uitgeschakeld (allow_short_selling=false)")
            approved = False
            blocked_by = "short_selling_disabled"

        # Stop loss quality check
        if req.stop_loss is None:
            warnings.append("Geen stop loss ingesteld - risico niet begrensd")

        # Correlation cluster check is done in check_async() where await is available

        return RiskCheckResult(
            approved=approved,
            required_manual_approval=required_manual,
            reasons=reasons,
            warnings=warnings,
            max_position_size=_max_position_size_usd(),
            blocked_by_rule=blocked_by,
        )

    async def check_async(self, req: RiskCheckRequest) -> RiskCheckResult:
        result = self.check(req)
        if not result.approved:
            return result

        # Correlation cluster check (async DB query)
        if req.side == "buy" and req.symbol and not req.is_closing_position:
            base = req.symbol.upper().split("/")[0]
            cluster_reasons = await _check_correlation_cluster_async(base)
            if cluster_reasons:
                return RiskCheckResult(
                    approved=False,
                    required_manual_approval=False,
                    reasons=cluster_reasons,
                    warnings=result.warnings,
                    max_position_size=result.max_position_size,
                    blocked_by_rule="correlation_cluster",
                )

        rule_result = await evaluate_active_rules(req)
        reasons = [*result.reasons, *rule_result.reasons]
        warnings = [*result.warnings, *rule_result.warnings]
        return RiskCheckResult(
            approved=result.approved and rule_result.approved,
            required_manual_approval=result.required_manual_approval or rule_result.required_manual,
            reasons=reasons,
            warnings=warnings,
            max_position_size=result.max_position_size,
            blocked_by_rule=rule_result.blocked_by_rule or result.blocked_by_rule,
        )

    async def get_status(self) -> dict:
        return {
            "trading_mode": get_runtime_value("trading_mode", settings.trading_mode),
            "live_trading_enabled": get_runtime_value("live_trading_enabled", settings.live_trading_enabled),
            "kill_switch_enabled": get_runtime_value("kill_switch_enabled", settings.kill_switch_enabled),
            "require_manual_confirmation": get_runtime_value("require_manual_confirmation", settings.require_manual_confirmation),
            "max_position_size_usd": _max_position_size_usd(),
            "max_daily_loss_pct": _max_daily_loss_pct(),
            "max_open_positions": _max_open_positions(),
            "max_trades_per_day": _max_trades_per_day(),
            "min_confidence_for_auto": _min_confidence_for_auto(),
            "auto_trade_threshold": _min_confidence_for_auto(),
            "position_size_pct": get_runtime_value("position_size_pct", settings.position_size_pct),
        }

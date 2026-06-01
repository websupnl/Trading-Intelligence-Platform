import logging
from typing import Optional
from app.gok.strategies import StrategyConfig

logger = logging.getLogger(__name__)

MAX_LOSS_PCT = 0.03       # max 3% van budget per trade verliezen
MIN_BUDGET_EUR = 5.0
MAX_BUDGET_EUR = 500.0
MAX_OPEN_GOK_POSITIONS = 3
MAX_DAILY_GOK_TRADES = 10


def calculate_atr(candles: list, period: int = 14) -> Optional[float]:
    """Average True Range berekening op basis van candle objects."""
    if len(candles) < period + 1:
        return None
    true_ranges = []
    for i in range(1, len(candles)):
        high = candles[i].high
        low = candles[i].low
        prev_close = candles[i - 1].close
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        true_ranges.append(tr)
    if not true_ranges:
        return None
    recent = true_ranges[-period:]
    return sum(recent) / len(recent)


def calculate_tp_sl(
    entry_price: float,
    atr: float,
    strategy: StrategyConfig,
    side: str = "buy",
) -> tuple[float, float]:
    """Bereken ATR-gebaseerde take profit en stop loss prijzen."""
    tp_distance = atr * strategy.atr_multiplier_tp
    sl_distance = atr * strategy.atr_multiplier_sl

    if side == "buy":
        tp = entry_price + tp_distance
        sl = entry_price - sl_distance
    else:
        tp = entry_price - tp_distance
        sl = entry_price + sl_distance

    return round(tp, 8), round(sl, 8)


def calculate_quantity(budget_eur: float, entry_price: float) -> float:
    """Bereken hoeveelheid op basis van budget en prijs."""
    if entry_price <= 0:
        return 0.0
    qty = budget_eur / entry_price
    # Minimale precisie voor crypto
    if entry_price > 1000:
        return round(qty, 6)
    elif entry_price > 1:
        return round(qty, 4)
    else:
        return round(qty, 2)


def validate_gok_trade(
    budget_eur: float,
    entry_price: float,
    stop_loss: float,
    open_positions: int,
    daily_trades: int,
    max_daily_trades: int,
    kill_switch: bool,
) -> tuple[bool, Optional[str]]:
    """Valideer of een gok trade toegestaan is. Geeft (ok, reden) terug."""
    if kill_switch:
        return False, "Kill switch actief"
    if open_positions >= MAX_OPEN_GOK_POSITIONS:
        return False, f"Maximaal {MAX_OPEN_GOK_POSITIONS} open gok posities"
    if daily_trades >= max_daily_trades:
        return False, f"Daglimiet van {max_daily_trades} gok trades bereikt"
    if budget_eur < MIN_BUDGET_EUR:
        return False, f"Minimaal budget is €{MIN_BUDGET_EUR:.0f}"
    if budget_eur > MAX_BUDGET_EUR:
        return False, f"Maximaal budget is €{MAX_BUDGET_EUR:.0f}"
    if entry_price <= 0:
        return False, "Ongeldige entry prijs"

    # Max loss check
    if stop_loss > 0 and entry_price > 0:
        potential_loss_pct = abs(entry_price - stop_loss) / entry_price
        if potential_loss_pct > 0.15:
            return False, f"Stop loss te ver: {potential_loss_pct:.1%} verlies mogelijk"

    return True, None

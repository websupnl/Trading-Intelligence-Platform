"""
Asset profiling — three distinct trading sub-systems with independent risk parameters.

STOCK        — US equities/ETFs.  Swing trades, market-hours only, fundamental+TA driven.
CRYPTO_CORE  — BTC, ETH, SOL, LTC, BCH.  Serious crypto, 24/7, TA+macro driven.
SPECULATIVE  — Altcoins, meme coins, volatile DeFi.  Small positions, fast exits, pure TA.
"""

from dataclasses import dataclass
from enum import Enum


class AssetTier(str, Enum):
    STOCK = "stock"
    CRYPTO_CORE = "crypto_core"
    SPECULATIVE = "speculative"


@dataclass(frozen=True)
class AssetProfile:
    tier: AssetTier
    label: str
    confidence_threshold: float
    position_size_pct: float       # fraction of equity; None = use runtime setting
    use_runtime_position_size: bool  # if True, position_size_pct is ignored and runtime value is used
    max_hold_hours: int
    max_notional_usd: float
    stop_loss_warning_pct: float   # warn in risk engine if SL is wider than this


# ── Tier membership ────────────────────────────────────────────────────────────

STOCK_SYMBOLS: frozenset[str] = frozenset({
    # Broad market ETFs
    "SPY", "QQQ",
    # FAANG / mega-cap
    "AAPL", "MSFT", "AMZN", "GOOGL", "META",
    # High-momentum tech
    "NVDA", "AMD", "TSLA", "MSTR",
    # High-beta growth
    "COIN", "PLTR", "CRWD", "HOOD",
})

CRYPTO_CORE_SYMBOLS: frozenset[str] = frozenset({
    "BTC", "ETH", "SOL", "LTC", "BCH",
})

SPECULATIVE_SYMBOLS: frozenset[str] = frozenset({
    "DOGE", "AVAX", "LINK", "AAVE", "UNI",
    "ALGO", "BAT", "CRV", "MKR", "SUSHI", "YFI", "XTZ",
})

# ── Profiles ───────────────────────────────────────────────────────────────────

STOCK_PROFILE = AssetProfile(
    tier=AssetTier.STOCK,
    label="Aandelen",
    confidence_threshold=0.62,        # higher bar — fundamentals + catalyst required
    position_size_pct=0.15,           # ignored; runtime position_size_pct is used
    use_runtime_position_size=True,
    max_hold_hours=120,               # up to 5 days for swing trades
    max_notional_usd=2000.0,
    stop_loss_warning_pct=0.05,
)

CRYPTO_CORE_PROFILE = AssetProfile(
    tier=AssetTier.CRYPTO_CORE,
    label="Crypto kern",
    confidence_threshold=0.55,
    position_size_pct=0.08,           # 8% of equity — crypto is more volatile than stocks
    use_runtime_position_size=False,
    max_hold_hours=48,
    max_notional_usd=1000.0,
    stop_loss_warning_pct=0.08,
)

SPECULATIVE_PROFILE = AssetProfile(
    tier=AssetTier.SPECULATIVE,
    label="Speculatief",
    confidence_threshold=0.70,        # much higher bar — high risk requires high conviction
    position_size_pct=0.03,           # 3% of equity — small bets, fast in/out
    use_runtime_position_size=False,
    max_hold_hours=8,                 # must close same session
    max_notional_usd=300.0,
    stop_loss_warning_pct=0.05,
)


# ── Lookup ─────────────────────────────────────────────────────────────────────

def get_asset_profile(symbol: str) -> AssetProfile:
    """Return the AssetProfile for a given ticker symbol."""
    base = symbol.upper().split("/")[0]
    if base in CRYPTO_CORE_SYMBOLS:
        return CRYPTO_CORE_PROFILE
    if base in SPECULATIVE_SYMBOLS:
        return SPECULATIVE_PROFILE
    if base in STOCK_SYMBOLS:
        return STOCK_PROFILE
    # Any other crypto-style symbol (e.g. new additions to CRYPTO_SYMBOLS) → speculative
    from app.services.alpaca_broker import CRYPTO_SYMBOLS
    if base in CRYPTO_SYMBOLS:
        return SPECULATIVE_PROFILE
    # Unknown → treat as stock (conservative default)
    return STOCK_PROFILE

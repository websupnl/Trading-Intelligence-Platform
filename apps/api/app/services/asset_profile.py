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
    confidence_threshold=0.65,         # raised — needs catalyst + TA confirmation
    position_size_pct=0.30,            # 30% of equity — swing trades, fewer but bigger
    use_runtime_position_size=False,   # profile controls sizing, not runtime toggle
    max_hold_hours=120,
    max_notional_usd=3000.0,
    stop_loss_warning_pct=0.05,
)

CRYPTO_CORE_PROFILE = AssetProfile(
    tier=AssetTier.CRYPTO_CORE,
    label="Crypto kern",
    confidence_threshold=0.60,         # raised from 0.55 — quality over quantity
    position_size_pct=0.25,            # 25% of equity — 3 max positions = 75% deployed
    use_runtime_position_size=False,
    max_hold_hours=48,
    max_notional_usd=3000.0,
    stop_loss_warning_pct=0.08,
)

SPECULATIVE_PROFILE = AssetProfile(
    tier=AssetTier.SPECULATIVE,
    label="Speculatief",
    confidence_threshold=0.72,         # high conviction required for volatile assets
    position_size_pct=0.12,            # 12% of equity — meaningful bet but bounded
    use_runtime_position_size=False,
    max_hold_hours=12,                 # must close within half a day
    max_notional_usd=1200.0,
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

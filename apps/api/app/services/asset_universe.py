"""
Central asset universe — single source of truth for all 3 trading strategies.

STRATEGY 1 — CRYPTO CORE (BTC/ETH/SOL)
  24/7 momentum trading. Continuous, high frequency.
  Broker: Bitvavo (EUR) preferred, Alpaca fallback.

STRATEGY 2 — STOCKS LONG (US equities + ETFs)
  Swing trades 1-7 days. US market hours only.
  Broker: Alpaca (USD).

STRATEGY 3 — SPECULATIVE (altcoins + meme)
  Event-driven. News/rumour/social catalyst required.
  Broker: Bitvavo (EUR) preferred, Alpaca fallback.
"""

from enum import Enum


class TradingStrategy(str, Enum):
    CRYPTO_CORE = "crypto_core"
    STOCKS_LONG = "stocks_long"
    SPECULATIVE = "speculative"


# === CRYPTO CORE — 24/7 momentum, highest priority ===
CRYPTO_CORE: frozenset[str] = frozenset({"BTC", "ETH", "SOL"})

# === STOCKS LONG — focused watchlist, swing trades ===
STOCKS_FOCUS: frozenset[str] = frozenset({
    # AI/semis — structural multi-year growth
    "NVDA", "AMD", "MSFT",
    # High-beta momentum
    "TSLA", "META", "COIN", "PLTR",
    # Broad market exposure
    "SPY", "QQQ",
    # Dutch/EU exposure via US-listed
    "ASML",
})

# === SPECULATIVE — altcoins + high-volatility ===
CRYPTO_SPECULATIVE: frozenset[str] = frozenset({
    "DOGE", "AVAX", "LINK", "LTC", "BCH",
    "AAVE", "UNI", "ALGO", "CRV", "BAT",
})

# Backwards-compatible combined sets used throughout the codebase
CRYPTO_SYMBOLS: frozenset[str] = CRYPTO_CORE | CRYPTO_SPECULATIVE
ALL_ASSETS: frozenset[str] = CRYPTO_SYMBOLS | STOCKS_FOCUS

# Assets that trade on Bitvavo (EUR pairs) — crypto only
BITVAVO_ASSETS: frozenset[str] = CRYPTO_SYMBOLS

# Signal generation watchlist per strategy
SIGNAL_WATCHLIST: dict[TradingStrategy, frozenset[str]] = {
    TradingStrategy.CRYPTO_CORE: CRYPTO_CORE,
    TradingStrategy.STOCKS_LONG: STOCKS_FOCUS,
    TradingStrategy.SPECULATIVE: CRYPTO_SPECULATIVE,
}


def get_strategy(symbol: str) -> TradingStrategy:
    base = symbol.upper().split("/")[0]
    if base in CRYPTO_CORE:
        return TradingStrategy.CRYPTO_CORE
    if base in CRYPTO_SPECULATIVE:
        return TradingStrategy.SPECULATIVE
    return TradingStrategy.STOCKS_LONG


def is_crypto(symbol: str) -> bool:
    base = symbol.upper().split("/")[0]
    return base in CRYPTO_SYMBOLS or "/" in symbol


def prefers_bitvavo(symbol: str) -> bool:
    return is_crypto(symbol)

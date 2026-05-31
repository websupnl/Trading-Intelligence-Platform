"""
Market regime detection — classifies current market conditions to dynamically
adjust confidence thresholds and position sizing.

BULL    — trend up, momentum positive → lower confidence threshold, normal sizing
BEAR    — trend down, momentum negative → higher threshold, reduced sizing
RANGING — low volatility, sideways → scalp-favoring, neutral sizing

Regime is computed from BTC (proxy for crypto market) and SPY (proxy for stocks)
using candles already in the DB. Stored in Redis, refreshed every hour.
"""

import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

REGIME_KEY = "market_regime"
REGIME_UPDATED_KEY = "market_regime_updated_at"
REGIME_TTL_MINUTES = 60


async def detect_regime(symbol: str = "BTC", timeframe: str = "1Day", lookback: int = 50) -> str:
    """Detect market regime from candle data. Returns 'bull', 'bear', or 'ranging'."""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Candle)
            .where(Candle.symbol == symbol, Candle.timeframe == timeframe)
            .order_by(Candle.timestamp.desc())
            .limit(lookback)
        )
        candles = list(reversed(result.scalars().all()))

    if len(candles) < 20:
        return "ranging"  # not enough data → neutral

    closes = [float(c.close) for c in candles]

    # EMA-20 and EMA-50
    def ema(values: list[float], period: int) -> list[float]:
        k = 2 / (period + 1)
        result = [values[0]]
        for v in values[1:]:
            result.append(v * k + result[-1] * (1 - k))
        return result

    ema20 = ema(closes, 20)
    ema50 = ema(closes, min(50, len(closes)))

    last_close = closes[-1]
    last_ema20 = ema20[-1]
    last_ema50 = ema50[-1]

    # RSI-14
    gains, losses = [], []
    for i in range(1, min(15, len(closes))):
        delta = closes[-i] - closes[-(i + 1)]
        (gains if delta > 0 else losses).append(abs(delta))
    avg_gain = sum(gains) / 14 if gains else 0
    avg_loss = sum(losses) / 14 if losses else 1e-9
    rsi = 100 - (100 / (1 + avg_gain / avg_loss))

    # ATR as volatility proxy (last 14 candles)
    highs = [float(c.high) for c in candles[-15:]]
    lows = [float(c.low) for c in candles[-15:]]
    trs = [max(h - l, abs(h - closes[max(0, i - 1)]), abs(l - closes[max(0, i - 1)]))
           for i, (h, l) in enumerate(zip(highs[1:], lows[1:]), 1)]
    atr = sum(trs) / len(trs) if trs else 0
    atr_pct = (atr / last_close * 100) if last_close > 0 else 0

    # Regime logic
    is_trending_up = last_close > last_ema20 > last_ema50
    is_trending_down = last_close < last_ema20 < last_ema50
    is_low_vol = atr_pct < 1.5  # less than 1.5% daily range → ranging

    if is_low_vol and not (is_trending_up or is_trending_down):
        regime = "ranging"
    elif is_trending_up and rsi > 48:
        regime = "bull"
    elif is_trending_down and rsi < 52:
        regime = "bear"
    elif last_close > last_ema20:
        regime = "bull"
    elif last_close < last_ema20:
        regime = "bear"
    else:
        regime = "ranging"

    logger.info(f"Marktregime [{symbol}]: {regime} | close={last_close:.2f} ema20={last_ema20:.2f} ema50={last_ema50:.2f} rsi={rsi:.1f} atr={atr_pct:.2f}%")
    return regime


async def get_market_regime(force_refresh: bool = False) -> str:
    """Get current market regime, refreshing from candles if older than TTL."""
    last_updated = get_runtime_value(REGIME_UPDATED_KEY, None)
    cached = get_runtime_value(REGIME_KEY, None)

    if not force_refresh and cached and last_updated:
        try:
            updated_at = datetime.fromisoformat(last_updated)
            if datetime.now(timezone.utc) - updated_at < timedelta(minutes=REGIME_TTL_MINUTES):
                return cached
        except Exception:
            pass

    # Detect from BTC candles (best 24/7 proxy for overall crypto sentiment)
    try:
        regime = await detect_regime("BTC", "1Day", 50)
    except Exception as e:
        logger.warning(f"Regime detectie fout: {e}")
        regime = "ranging"

    set_runtime_value(REGIME_KEY, regime)
    set_runtime_value(REGIME_UPDATED_KEY, datetime.now(timezone.utc).isoformat())
    return regime


def get_regime_confidence_adjustment(regime: str) -> float:
    """Return confidence threshold adjustment for current regime.
    Bull: lower bar (more trades), Bear: higher bar (fewer trades), Ranging: neutral."""
    return {"bull": -0.04, "bear": +0.05, "ranging": 0.0}.get(regime, 0.0)


def get_regime_size_multiplier(regime: str) -> float:
    """Return position size multiplier for current regime."""
    return {"bull": 1.2, "bear": 0.7, "ranging": 1.0}.get(regime, 1.0)

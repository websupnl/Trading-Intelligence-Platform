import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import desc, select

from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.models.regime import RegimeState
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

ORACLE_REGIME_KEY = "oracle_regime_state"


def _ema(values: list[float], period: int) -> float | None:
    if len(values) < period:
        return None
    k = 2 / (period + 1)
    result = values[0]
    for value in values[1:]:
        result = value * k + result * (1 - k)
    return result


def _pct_vs(value: float | None, baseline: float | None) -> float | None:
    if value is None or baseline in (None, 0):
        return None
    return round(((value / baseline) - 1) * 100, 4)


async def _load_closes(symbol: str, timeframe: str = "1Day", limit: int = 220) -> list[float]:
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Candle)
            .where(Candle.symbol == symbol, Candle.timeframe == timeframe)
            .order_by(desc(Candle.timestamp))
            .limit(limit)
        )
        candles = list(reversed(result.scalars().all()))
    return [float(c.close) for c in candles if c.close is not None]


async def _asset_metrics(symbol: str) -> dict[str, Any]:
    closes = await _load_closes(symbol)
    last = closes[-1] if closes else None
    ema50 = _ema(closes, 50)
    ema200 = _ema(closes, 200)
    return {
        "symbol": symbol,
        "last": last,
        "ema50": ema50,
        "ema200": ema200,
        "vs_ema50": _pct_vs(last, ema50),
        "vs_ema200": _pct_vs(last, ema200),
        "data_points": len(closes),
    }


def _classify(metrics: dict[str, Any]) -> tuple[str, float, str]:
    spy = metrics.get("spy") or {}
    btc = metrics.get("btc") or {}
    vix = metrics.get("vix")

    score = 0
    evidence: list[str] = []

    if vix is not None:
        if vix > 40:
            return "crisis", 0.90, f"VIX extreem hoog ({vix:.1f})"
        if vix > 25:
            score -= 2
            evidence.append(f"VIX risk-off ({vix:.1f})")
        elif vix < 18:
            score += 1
            evidence.append(f"VIX rustig ({vix:.1f})")

    if spy.get("vs_ema50") is not None:
        if spy["vs_ema50"] > 0:
            score += 1
            evidence.append("SPY boven EMA50")
        else:
            score -= 1
            evidence.append("SPY onder EMA50")
    if spy.get("vs_ema200") is not None:
        if spy["vs_ema200"] > 0:
            score += 1
            evidence.append("SPY boven EMA200")
        else:
            score -= 1
            evidence.append("SPY onder EMA200")

    if btc.get("vs_ema50") is not None:
        if btc["vs_ema50"] > 0:
            score += 1
            evidence.append("BTC boven EMA50")
        else:
            score -= 1
            evidence.append("BTC onder EMA50")

    if score >= 2:
        regime = "risk_on"
    elif score <= -2:
        regime = "risk_off"
    else:
        regime = "chop"

    available = sum(1 for key in ("spy", "btc") if (metrics.get(key) or {}).get("data_points", 0) >= 50)
    if vix is not None:
        available += 1
    confidence = min(0.85, 0.45 + (available * 0.12) + (abs(score) * 0.05))
    notes = ", ".join(evidence) if evidence else "Onvoldoende marktdata; neutraal regime."
    return regime, round(confidence, 4), notes


async def detect_oracle_regime(*, persist: bool = True) -> dict[str, Any]:
    """Compute Oracle's high-level market regime and optionally persist it."""
    spy = await _asset_metrics("SPY")
    btc = await _asset_metrics("BTC")
    vix_series = await _load_closes("VIX", limit=5)
    vix = vix_series[-1] if vix_series else None

    metrics = {
        "spy": spy,
        "btc": btc,
        "vix": vix,
        "source": "local_candles",
    }
    regime, confidence, notes = _classify(metrics)
    now = datetime.now(timezone.utc)

    state = {
        "regime": regime,
        "vix": vix,
        "spy_vs_ema50": spy.get("vs_ema50"),
        "spy_vs_ema200": spy.get("vs_ema200"),
        "btc_dominance": None,
        "dollar_trend": None,
        "computed_at": now.isoformat(),
        "confidence": confidence,
        "notes": notes,
        "metrics": metrics,
    }

    set_runtime_value(ORACLE_REGIME_KEY, state)

    # Keep existing downstream sizing logic in sync.
    legacy = {"risk_on": "bull", "risk_off": "bear", "crisis": "bear", "chop": "ranging"}[regime]
    set_runtime_value("market_regime", legacy)
    set_runtime_value("market_regime_updated_at", now.isoformat())

    if persist:
        async with AsyncSessionLocal() as db:
            db.add(RegimeState(
                regime=regime,
                vix=vix,
                spy_vs_ema50=spy.get("vs_ema50"),
                spy_vs_ema200=spy.get("vs_ema200"),
                btc_dominance=None,
                dollar_trend=None,
                computed_at=now,
                confidence=confidence,
                notes=notes,
                metrics=metrics,
            ))
            await db.commit()

    logger.info("Oracle regime: %s confidence=%.2f notes=%s", regime, confidence, notes)
    return state


async def get_current_oracle_regime() -> dict[str, Any]:
    cached = get_runtime_value(ORACLE_REGIME_KEY, None)
    if cached:
        return cached

    async with AsyncSessionLocal() as db:
        result = await db.execute(select(RegimeState).order_by(desc(RegimeState.computed_at)).limit(1))
        state = result.scalar_one_or_none()

    if state:
        payload = {
            "regime": state.regime,
            "vix": state.vix,
            "spy_vs_ema50": state.spy_vs_ema50,
            "spy_vs_ema200": state.spy_vs_ema200,
            "btc_dominance": state.btc_dominance,
            "dollar_trend": state.dollar_trend,
            "computed_at": state.computed_at.isoformat(),
            "confidence": state.confidence,
            "notes": state.notes,
            "metrics": state.metrics,
        }
        set_runtime_value(ORACLE_REGIME_KEY, payload)
        return payload

    return await detect_oracle_regime(persist=True)

import logging
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote

import httpx
from sqlalchemy import desc, select

from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.models.regime import RegimeState
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

ORACLE_REGIME_KEY = "oracle_regime_state"
HTTP_TIMEOUT = 8.0


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
    return _metrics_from_closes(symbol, closes, source="local_candles")


def _metrics_from_closes(symbol: str, closes: list[float], *, source: str) -> dict[str, Any]:
    last = closes[-1] if closes else None
    ema50 = _ema(closes, 50)
    ema200 = _ema(closes, 200)
    return {
        "symbol": symbol,
        "source": source,
        "last": last,
        "ema50": ema50,
        "ema200": ema200,
        "vs_ema50": _pct_vs(last, ema50),
        "vs_ema200": _pct_vs(last, ema200),
        "data_points": len(closes),
    }


async def _fetch_yahoo_closes(symbol: str, *, days: int = 260) -> list[float]:
    encoded = quote(symbol, safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded}"
    params = {"range": "1y", "interval": "1d"}
    headers = {"User-Agent": "trading-os/1.0"}
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        resp = await client.get(url, params=params, headers=headers)
        resp.raise_for_status()
        data = resp.json()
    result = ((data.get("chart") or {}).get("result") or [None])[0] or {}
    quote_data = (((result.get("indicators") or {}).get("quote") or [None])[0] or {})
    closes = [float(v) for v in (quote_data.get("close") or []) if v is not None]
    return closes[-days:]


async def _yahoo_asset_metrics(symbol: str, *, fallback_symbol: str | None = None) -> dict[str, Any]:
    try:
        closes = await _fetch_yahoo_closes(symbol)
        if closes:
            return _metrics_from_closes(symbol, closes, source="yahoo")
    except Exception as exc:
        logger.warning("Yahoo data mislukt voor %s: %s", symbol, exc)
    if fallback_symbol:
        fallback = await _asset_metrics(fallback_symbol)
        fallback["source"] = f"local_candles:{fallback_symbol}"
        fallback["symbol"] = symbol
        return fallback
    return _metrics_from_closes(symbol, [], source="unavailable")


async def _fetch_btc_dominance() -> float | None:
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
            resp = await client.get("https://api.coingecko.com/api/v3/global")
            resp.raise_for_status()
            data = resp.json()
        dominance = ((data.get("data") or {}).get("market_cap_percentage") or {}).get("btc")
        return round(float(dominance), 4) if dominance is not None else None
    except Exception as exc:
        logger.warning("CoinGecko BTC dominance mislukt: %s", exc)
        return None


async def _vix_value() -> float | None:
    try:
        vix_series = await _fetch_yahoo_closes("^VIX", days=5)
    except Exception as exc:
        logger.warning("Yahoo VIX mislukt: %s", exc)
        vix_series = []
    if not vix_series:
        vix_series = await _load_closes("VIX", limit=5)
    return vix_series[-1] if vix_series else None


async def _credit_metrics() -> dict[str, Any]:
    try:
        hyg, lqd = await _fetch_yahoo_closes("HYG"), await _fetch_yahoo_closes("LQD")
        length = min(len(hyg), len(lqd))
        if length < 50:
            return {"source": "yahoo", "data_points": length}
        ratios = [hyg[-length + i] / lqd[-length + i] for i in range(length) if lqd[-length + i]]
        last = ratios[-1]
        ema50 = _ema(ratios, 50)
        return {
            "source": "yahoo",
            "hyg_lqd_ratio": round(last, 6),
            "ema50": round(ema50, 6) if ema50 is not None else None,
            "vs_ema50": _pct_vs(last, ema50),
            "data_points": len(ratios),
        }
    except Exception as exc:
        logger.warning("Credit ratio HYG/LQD mislukt: %s", exc)
        return {"source": "unavailable", "data_points": 0}


async def _dollar_metrics() -> dict[str, Any]:
    for symbol in ("DX-Y.NYB", "UUP"):
        try:
            closes = await _fetch_yahoo_closes(symbol)
            if len(closes) >= 20:
                last = closes[-1]
                previous = closes[-20]
                trend_pct = _pct_vs(last, previous)
                if trend_pct is None:
                    trend = "unknown"
                elif trend_pct > 1.0:
                    trend = "up"
                elif trend_pct < -1.0:
                    trend = "down"
                else:
                    trend = "neutral"
                return {
                    "source": "yahoo",
                    "symbol": symbol,
                    "last": last,
                    "trend_pct_20d": trend_pct,
                    "trend": trend,
                    "data_points": len(closes),
                }
        except Exception as exc:
            logger.warning("Dollar data mislukt voor %s: %s", symbol, exc)
    return {"source": "unavailable", "trend": "unknown", "data_points": 0}


def _classify(metrics: dict[str, Any]) -> tuple[str, float, str]:
    spy = metrics.get("spy") or {}
    btc = metrics.get("btc") or {}
    vix = metrics.get("vix")
    credit = metrics.get("credit") or {}
    dollar = metrics.get("dollar") or {}
    btc_dominance = metrics.get("btc_dominance")

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

    if credit.get("vs_ema50") is not None:
        if credit["vs_ema50"] > 0:
            score += 1
            evidence.append("HYG/LQD credit risk-on")
        elif credit["vs_ema50"] < -1.0:
            score -= 1
            evidence.append("HYG/LQD credit risk-off")

    if dollar.get("trend") == "up":
        score -= 1
        evidence.append("Dollar sterker")
    elif dollar.get("trend") == "down":
        score += 1
        evidence.append("Dollar zwakker")

    if btc_dominance is not None:
        if btc_dominance < 52:
            score += 1
            evidence.append(f"BTC dominance alt-vriendelijk ({btc_dominance:.1f}%)")
        elif btc_dominance > 58:
            score -= 1
            evidence.append(f"BTC dominance defensief ({btc_dominance:.1f}%)")

    if score >= 2:
        regime = "risk_on"
    elif score <= -2:
        regime = "risk_off"
    else:
        regime = "chop"

    available = sum(1 for key in ("spy", "btc") if (metrics.get(key) or {}).get("data_points", 0) >= 50)
    if vix is not None:
        available += 1
    if credit.get("data_points", 0) >= 50:
        available += 1
    if dollar.get("data_points", 0) >= 20:
        available += 1
    if btc_dominance is not None:
        available += 1
    confidence = min(0.85, 0.45 + (available * 0.12) + (abs(score) * 0.05))
    notes = ", ".join(evidence) if evidence else "Onvoldoende marktdata; neutraal regime."
    return regime, round(confidence, 4), notes


async def detect_oracle_regime(*, persist: bool = True) -> dict[str, Any]:
    """Compute Oracle's high-level market regime and optionally persist it."""
    spy = await _yahoo_asset_metrics("SPY", fallback_symbol="SPY")
    btc = await _asset_metrics("BTC")
    vix = await _vix_value()
    credit = await _credit_metrics()
    dollar = await _dollar_metrics()
    btc_dominance = await _fetch_btc_dominance()

    metrics = {
        "spy": spy,
        "btc": btc,
        "vix": vix,
        "credit": credit,
        "dollar": dollar,
        "btc_dominance": btc_dominance,
    }
    regime, confidence, notes = _classify(metrics)
    now = datetime.now(timezone.utc)

    state = {
        "regime": regime,
        "vix": vix,
        "spy_vs_ema50": spy.get("vs_ema50"),
        "spy_vs_ema200": spy.get("vs_ema200"),
        "btc_dominance": btc_dominance,
        "dollar_trend": dollar.get("trend"),
        "computed_at": now.isoformat(),
        "confidence": confidence,
        "notes": notes,
        "metrics": metrics,
    }

    set_runtime_value(ORACLE_REGIME_KEY, state)

    # NOTE: the Oracle regime is SPY/stocks-driven and must NOT overwrite the
    # crypto-facing `market_regime` key — doing so told the crypto signal
    # generator "bull, be more aggressive" while crypto sat in extreme fear.
    # The crypto `market_regime` is now owned solely by market_regime.py
    # (BTC-based). The Oracle state lives under ORACLE_REGIME_KEY for display.

    if persist:
        async with AsyncSessionLocal() as db:
            db.add(RegimeState(
                regime=regime,
                vix=vix,
                spy_vs_ema50=spy.get("vs_ema50"),
                spy_vs_ema200=spy.get("vs_ema200"),
                btc_dominance=btc_dominance,
                dollar_trend=dollar.get("trend"),
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

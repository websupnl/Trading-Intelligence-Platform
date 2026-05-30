"""Market context: Fear & Greed index + BTC trend for signal enrichment."""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any
import httpx
from app.services.runtime_state import get_runtime_value, set_runtime_value

logger = logging.getLogger(__name__)

CACHE_KEY = "market_context_cache"
CACHE_TTL_MINUTES = 30


def _cached() -> dict | None:
    val = get_runtime_value(CACHE_KEY, None)
    if not val or not isinstance(val, dict):
        return None
    cached_at_str = val.get("cached_at", "")
    try:
        cached_at = datetime.fromisoformat(cached_at_str)
        if (datetime.now(timezone.utc) - cached_at) < timedelta(minutes=CACHE_TTL_MINUTES):
            return val
    except Exception:
        pass
    return None


async def get_market_context() -> dict[str, Any]:
    """Return Fear & Greed + BTC context. Cached 30 min."""
    cached = _cached()
    if cached:
        return cached

    ctx: dict[str, Any] = {
        "fear_greed_value": None,
        "fear_greed_label": None,
        "btc_trend": None,
        "btc_price": None,
        "market_bias": "neutral",
        "cached_at": datetime.now(timezone.utc).isoformat(),
    }

    # Fear & Greed Index
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get("https://api.alternative.me/fng/?limit=1")
            if resp.status_code == 200:
                data = resp.json().get("data", [{}])[0]
                val = int(data.get("value", 50))
                label = data.get("value_classification", "Neutral")
                ctx["fear_greed_value"] = val
                ctx["fear_greed_label"] = label
                if val <= 25:
                    ctx["market_bias"] = "extreme_fear"
                elif val <= 45:
                    ctx["market_bias"] = "fear"
                elif val >= 75:
                    ctx["market_bias"] = "extreme_greed"
                elif val >= 55:
                    ctx["market_bias"] = "greed"
                else:
                    ctx["market_bias"] = "neutral"
    except Exception as e:
        logger.debug("Fear & Greed API niet bereikbaar: %s", e)

    # BTC price & trend from DB
    try:
        from app.database import AsyncSessionLocal
        from app.models.candles import Candle
        from sqlalchemy import select
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Candle)
                .where(Candle.symbol == "BTC", Candle.timeframe == "1Day")
                .order_by(Candle.timestamp.desc())
                .limit(10)
            )
            candles = result.scalars().all()
            if candles:
                latest = candles[0]
                ctx["btc_price"] = round(latest.close, 0)
                if len(candles) >= 5:
                    closes = [c.close for c in reversed(candles)]
                    ema5 = sum(closes[-5:]) / 5
                    pct = (closes[-1] - closes[-5]) / closes[-5] * 100
                    if closes[-1] > ema5 and pct > 1:
                        ctx["btc_trend"] = "uptrend"
                    elif closes[-1] < ema5 and pct < -1:
                        ctx["btc_trend"] = "downtrend"
                    else:
                        ctx["btc_trend"] = "sideways"
    except Exception as e:
        logger.debug("BTC context ophalen mislukt: %s", e)

    set_runtime_value(CACHE_KEY, ctx)
    return ctx


def format_for_prompt(ctx: dict) -> str:
    """Format market context as a short prompt block."""
    lines = []
    fg = ctx.get("fear_greed_value")
    if fg is not None:
        label = ctx.get("fear_greed_label", "")
        bias = ctx.get("market_bias", "neutral")
        lines.append(f"Fear & Greed Index: {fg}/100 ({label})")
        if bias == "extreme_fear":
            lines.append("→ EXTREME FEAR: historisch gunstig koopmoment voor contrarians")
        elif bias == "fear":
            lines.append("→ FEAR: markt pessimistisch, oversold kansen verhoogd")
        elif bias == "extreme_greed":
            lines.append("→ EXTREME GREED: markt overbought, wees voorzichtig met nieuwe longs")
        elif bias == "greed":
            lines.append("→ GREED: momentum aanwezig maar overbought risico")
        else:
            lines.append("→ NEUTRAAL: geen sterke marktbias")

    btc = ctx.get("btc_price")
    btc_trend = ctx.get("btc_trend")
    if btc:
        lines.append(f"BTC: ${btc:,.0f} ({btc_trend or 'onbekend'})")
        if btc_trend == "uptrend":
            lines.append("→ BTC in uptrend: altcoin lag-plays zijn kansrijker")
        elif btc_trend == "downtrend":
            lines.append("→ BTC in downtrend: wees extra selectief, alleen sterke setups")

    return "\n".join(lines) if lines else "Marktcontext niet beschikbaar"

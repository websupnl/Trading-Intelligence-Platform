from dataclasses import dataclass, field
from typing import Optional


@dataclass
class TAResult:
    score: float           # -1.0 to 1.0
    rsi: Optional[float]
    macd_signal: str       # bullish_cross | bearish_cross | bullish | bearish | neutral
    trend: str             # uptrend | downtrend | sideways
    volume_signal: str     # high | normal | low
    summary: str
    ema20: Optional[float] = None
    ema50: Optional[float] = None
    pct_from_ema20: Optional[float] = None
    pct_from_ema50: Optional[float] = None
    setup_type: str = "none"   # oversold_bounce | momentum_breakout | overbought | scalp_breakout | none
    # New: intraday indicators
    bb_upper: Optional[float] = None
    bb_lower: Optional[float] = None
    bb_pct: Optional[float] = None     # 0=at lower band, 1=at upper band
    bb_squeeze: bool = False            # bands narrowing = volatility contraction
    candlestick_patterns: list = field(default_factory=list)
    support: Optional[float] = None
    resistance: Optional[float] = None
    at_support: bool = False
    at_resistance: bool = False
    atr: Optional[float] = None        # Average True Range — stop sizing
    momentum_1h: Optional[float] = None  # price change % last candle


def _ema(values: list[float], period: int) -> list[float]:
    if len(values) < period:
        return []
    k = 2 / (period + 1)
    ema = [sum(values[:period]) / period]
    for v in values[period:]:
        ema.append(v * k + ema[-1] * (1 - k))
    return ema


def _rsi(closes: list[float], period: int = 14) -> Optional[float]:
    if len(closes) < period + 1:
        return None
    deltas = [closes[i] - closes[i - 1] for i in range(1, len(closes))]
    gains = [d if d > 0 else 0 for d in deltas]
    losses = [-d if d < 0 else 0 for d in deltas]
    avg_gain = sum(gains[:period]) / period
    avg_loss = sum(losses[:period]) / period
    for i in range(period, len(gains)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    return 100 - (100 / (1 + avg_gain / avg_loss))


def _bollinger(closes: list[float], period: int = 20, mult: float = 2.0):
    if len(closes) < period:
        return None, None, None, None
    sma = sum(closes[-period:]) / period
    variance = sum((c - sma) ** 2 for c in closes[-period:]) / period
    std = variance ** 0.5
    upper = sma + mult * std
    lower = sma - mult * std
    current = closes[-1]
    pct = (current - lower) / (upper - lower) if (upper - lower) > 0 else 0.5
    return upper, lower, round(pct, 3), round(std / sma, 4)  # last: bandwidth


def _atr(candles, period: int = 14) -> Optional[float]:
    if len(candles) < period + 1:
        return None
    trs = []
    for i in range(1, len(candles)):
        high, low, prev_close = candles[i].high, candles[i].low, candles[i - 1].close
        trs.append(max(high - low, abs(high - prev_close), abs(low - prev_close)))
    if not trs:
        return None
    return sum(trs[-period:]) / min(period, len(trs))


def _candlestick_patterns(candles) -> list[str]:
    """Detect recent 1-3 candle patterns."""
    patterns = []
    if len(candles) < 2:
        return patterns
    c = candles[-1]
    p = candles[-2]

    body_c = abs(c.close - c.open)
    range_c = c.high - c.low or 0.001
    body_pct = body_c / range_c

    bull_c = c.close > c.open
    bull_p = p.close > p.open
    body_p = abs(p.close - p.open)

    # Doji — indecision
    if body_pct < 0.1:
        patterns.append("doji")

    # Hammer — bullish reversal (long lower wick)
    if bull_c:
        lower_wick = c.open - c.low
        upper_wick = c.high - c.close
        if body_c > 0 and lower_wick > body_c * 2 and upper_wick < body_c * 0.5:
            patterns.append("hammer")

    # Shooting star — bearish reversal (long upper wick)
    if not bull_c:
        upper_wick = c.high - c.open
        lower_wick = c.close - c.low
        if body_c > 0 and upper_wick > body_c * 2 and lower_wick < body_c * 0.5:
            patterns.append("shooting_star")

    # Bullish engulfing
    if bull_c and not bull_p and body_p > 0:
        if c.close > p.open and c.open < p.close:
            patterns.append("bullish_engulfing")

    # Bearish engulfing
    if not bull_c and bull_p and body_p > 0:
        if c.close < p.open and c.open > p.close:
            patterns.append("bearish_engulfing")

    # Marubozu — strong directional candle (small wicks)
    if body_pct > 0.8:
        patterns.append("marubozu_bullish" if bull_c else "marubozu_bearish")

    # Pin bar — long wick rejection
    if len(candles) >= 3:
        if (c.high - max(c.open, c.close)) > range_c * 0.6:
            patterns.append("pin_bar_bearish")
        elif (min(c.open, c.close) - c.low) > range_c * 0.6:
            patterns.append("pin_bar_bullish")

    return patterns


def _support_resistance(candles, lookback: int = 30) -> dict:
    """Find recent support/resistance from swing highs/lows."""
    if len(candles) < 5:
        return {}
    recent = candles[-lookback:]
    closes = [c.close for c in recent]
    highs = [c.high for c in recent]
    lows = [c.low for c in recent]
    current = closes[-1]

    # Simple: recent significant lows = support, highs = resistance
    recent_low = min(lows[-20:]) if len(lows) >= 20 else min(lows)
    recent_high = max(highs[-20:]) if len(highs) >= 20 else max(highs)

    at_support = (current - recent_low) / recent_low < 0.03  # within 3%
    at_resistance = (recent_high - current) / current < 0.03

    return {
        "support": round(recent_low, 6),
        "resistance": round(recent_high, 6),
        "at_support": at_support,
        "at_resistance": at_resistance,
    }


def analyze(candles) -> TAResult:
    """Full TA analysis. Works for any timeframe (1min, 15min, 1H, 1Day)."""
    if len(candles) < 5:
        return TAResult(score=0.0, rsi=None, macd_signal="neutral",
                        trend="sideways", volume_signal="normal",
                        summary="Onvoldoende data")

    closes = [c.close for c in candles]
    volumes = [c.volume for c in candles]
    score = 0.0
    signals = []

    # RSI
    rsi = _rsi(closes)
    if rsi is not None:
        if rsi < 25:
            score += 0.40; signals.append(f"RSI {rsi:.0f} zeer oversold")
        elif rsi < 35:
            score += 0.25; signals.append(f"RSI {rsi:.0f} oversold")
        elif rsi < 42:
            score += 0.12; signals.append(f"RSI {rsi:.0f} licht oversold")
        elif rsi > 78:
            score -= 0.40; signals.append(f"RSI {rsi:.0f} zeer overbought")
        elif rsi > 68:
            score -= 0.20; signals.append(f"RSI {rsi:.0f} overbought")

    # MACD
    macd_signal = "neutral"
    if len(closes) >= 26:
        ema12 = _ema(closes, 12)
        ema26 = _ema(closes, 26)
        if ema12 and ema26:
            n = min(len(ema12), len(ema26))
            macd_line = [ema12[-(n-i)] - ema26[-(n-i)] for i in range(n)]
            if len(macd_line) >= 9:
                sig_line = _ema(macd_line, 9)
                if sig_line and len(sig_line) >= 2:
                    if macd_line[-1] > sig_line[-1] and macd_line[-2] <= sig_line[-2]:
                        score += 0.30; macd_signal = "bullish_cross"; signals.append("MACD bullish crossover")
                    elif macd_line[-1] < sig_line[-1] and macd_line[-2] >= sig_line[-2]:
                        score -= 0.30; macd_signal = "bearish_cross"; signals.append("MACD bearish crossover")
                    elif macd_line[-1] > sig_line[-1]:
                        score += 0.10; macd_signal = "bullish"
                    elif macd_line[-1] < sig_line[-1]:
                        score -= 0.10; macd_signal = "bearish"

    # EMA20/50 + trend
    trend = "sideways"
    ema20_val = ema50_val = pct20 = pct50 = None
    if len(closes) >= 20:
        e20 = _ema(closes, 20)
        if e20:
            ema20_val = e20[-1]
            pct20 = (closes[-1] - ema20_val) / ema20_val
            if pct20 > 0.015:
                score += 0.20; trend = "uptrend"; signals.append(f"Prijs {pct20:.1%} boven EMA20")
            elif pct20 < -0.015:
                score -= 0.20; trend = "downtrend"; signals.append(f"Prijs {pct20:.1%} onder EMA20")
    if len(closes) >= 50:
        e50 = _ema(closes, 50)
        if e50:
            ema50_val = e50[-1]
            pct50 = (closes[-1] - ema50_val) / ema50_val
            if ema20_val and ema20_val > ema50_val:
                score += 0.08; signals.append("EMA20 > EMA50")
            elif ema20_val and ema20_val < ema50_val:
                score -= 0.08

    # Bollinger Bands
    bb_upper = bb_lower = bb_pct = bb_squeeze = None
    bb_squeeze_flag = False
    if len(closes) >= 20:
        bb_upper, bb_lower, bb_pct, bandwidth = _bollinger(closes)
        if bb_upper and bb_lower and bb_pct is not None:
            if bb_pct < 0.1:
                score += 0.20; signals.append(f"Bij lower Bollinger Band (oversold, {bb_pct:.0%})")
            elif bb_pct > 0.9:
                score -= 0.20; signals.append(f"Bij upper Bollinger Band (overbought, {bb_pct:.0%})")
            # Squeeze = low bandwidth → volatility coming
            if bandwidth is not None and bandwidth < 0.02:
                bb_squeeze_flag = True; signals.append("Bollinger squeeze — uitbraak verwacht")

    # Volume
    volume_signal = "normal"
    if len(volumes) >= 10:
        avg_vol = sum(volumes[-10:-1]) / 9
        last_vol = volumes[-1]
        if avg_vol > 0:
            ratio = last_vol / avg_vol
            if ratio > 2.5:
                score += 0.15 if score > 0 else -0.15
                volume_signal = "high"; signals.append(f"Volume {ratio:.1f}x gemiddelde")
            elif ratio < 0.4:
                volume_signal = "low"

    # ATR
    atr_val = _atr(candles)

    # Candlestick patterns
    patterns = _candlestick_patterns(candles)
    for pat in patterns:
        if "bullish" in pat or pat in ("hammer", "pin_bar_bullish"):
            score += 0.12; signals.append(f"Patroon: {pat}")
        elif "bearish" in pat or pat in ("shooting_star", "pin_bar_bearish"):
            score -= 0.12; signals.append(f"Patroon: {pat}")
        elif pat == "doji":
            signals.append("Doji (indecisie)")

    # Support/resistance
    sr = _support_resistance(candles)
    if sr.get("at_support"):
        score += 0.15; signals.append(f"Prijs op steun ${sr['support']:.2f}")
    if sr.get("at_resistance"):
        score -= 0.10; signals.append(f"Prijs op weerstand ${sr['resistance']:.2f}")

    # Momentum (last candle change)
    momentum = None
    if len(closes) >= 2:
        momentum = round((closes[-1] - closes[-2]) / closes[-2] * 100, 3)

    # Setup classification
    setup_type = "none"
    if rsi is not None:
        if rsi < 38 and trend in ("downtrend", "sideways"):
            setup_type = "oversold_bounce"
        elif rsi > 72:
            setup_type = "overbought"
        elif 44 <= rsi <= 64 and macd_signal in ("bullish_cross", "bullish") and trend == "uptrend":
            setup_type = "momentum_breakout"
        elif bb_squeeze_flag and abs(score) > 0.2:
            setup_type = "scalp_breakout"

    score = max(-1.0, min(1.0, score))
    summary = " | ".join(signals) if signals else "Geen duidelijke signalen"

    return TAResult(
        score=score, rsi=rsi, macd_signal=macd_signal,
        trend=trend, volume_signal=volume_signal, summary=summary,
        ema20=round(ema20_val, 4) if ema20_val else None,
        ema50=round(ema50_val, 4) if ema50_val else None,
        pct_from_ema20=round(pct20 * 100, 2) if pct20 is not None else None,
        pct_from_ema50=round(pct50 * 100, 2) if pct50 is not None else None,
        setup_type=setup_type,
        bb_upper=round(bb_upper, 4) if bb_upper else None,
        bb_lower=round(bb_lower, 4) if bb_lower else None,
        bb_pct=bb_pct,
        bb_squeeze=bb_squeeze_flag,
        candlestick_patterns=patterns,
        support=sr.get("support"),
        resistance=sr.get("resistance"),
        at_support=sr.get("at_support", False),
        at_resistance=sr.get("at_resistance", False),
        atr=round(atr_val, 4) if atr_val else None,
        momentum_1h=momentum,
    )

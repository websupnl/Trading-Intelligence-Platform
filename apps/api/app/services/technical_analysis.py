from dataclasses import dataclass
from typing import Optional


@dataclass
class TAResult:
    score: float          # -1.0 (bearish) to 1.0 (bullish)
    rsi: Optional[float]
    macd_signal: str      # "bullish_cross" | "bearish_cross" | "bullish" | "bearish" | "neutral"
    trend: str            # "uptrend" | "downtrend" | "sideways"
    volume_signal: str    # "high" | "normal" | "low"
    summary: str
    ema20: Optional[float] = None
    ema50: Optional[float] = None
    pct_from_ema20: Optional[float] = None
    pct_from_ema50: Optional[float] = None
    setup_type: str = "none"   # "oversold_bounce" | "momentum_breakout" | "overbought" | "none"


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
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def analyze(candles) -> TAResult:
    """Analyze a list of Candle objects. Returns TAResult."""
    if len(candles) < 5:
        return TAResult(score=0.0, rsi=None, macd_signal="neutral",
                       trend="sideways", volume_signal="normal",
                       summary="Onvoldoende data voor technische analyse")

    closes = [c.close for c in candles]
    volumes = [c.volume for c in candles]

    score = 0.0
    signals = []

    # RSI
    rsi = _rsi(closes)
    rsi_signal = "neutral"
    if rsi is not None:
        if rsi < 30:
            score += 0.35
            rsi_signal = "oversold"
            signals.append(f"RSI {rsi:.0f} oversold")
        elif rsi < 40:
            score += 0.15
            rsi_signal = "mildly_oversold"
            signals.append(f"RSI {rsi:.0f} licht oversold")
        elif rsi > 70:
            score -= 0.35
            rsi_signal = "overbought"
            signals.append(f"RSI {rsi:.0f} overbought")
        elif rsi > 60:
            score -= 0.15
            rsi_signal = "mildly_overbought"

    # MACD (12/26/9)
    macd_signal = "neutral"
    if len(closes) >= 26:
        ema12 = _ema(closes, 12)
        ema26 = _ema(closes, 26)
        if ema12 and ema26:
            min_len = min(len(ema12), len(ema26))
            macd_line = [ema12[-(min_len - i)] - ema26[-(min_len - i)] for i in range(min_len)]
            if len(macd_line) >= 9:
                signal_line = _ema(macd_line, 9)
                if signal_line and len(signal_line) >= 2:
                    if macd_line[-1] > signal_line[-1] and macd_line[-2] <= signal_line[-2]:
                        score += 0.30
                        macd_signal = "bullish_cross"
                        signals.append("MACD bullish crossover")
                    elif macd_line[-1] < signal_line[-1] and macd_line[-2] >= signal_line[-2]:
                        score -= 0.30
                        macd_signal = "bearish_cross"
                        signals.append("MACD bearish crossover")
                    elif macd_line[-1] > signal_line[-1]:
                        score += 0.10
                        macd_signal = "bullish"
                    elif macd_line[-1] < signal_line[-1]:
                        score -= 0.10
                        macd_signal = "bearish"

    # Trend (EMA20 + EMA50 vs current price)
    trend = "sideways"
    ema20_val: Optional[float] = None
    ema50_val: Optional[float] = None
    pct_from_ema20: Optional[float] = None
    pct_from_ema50: Optional[float] = None

    if len(closes) >= 20:
        ema20_list = _ema(closes, 20)
        if ema20_list:
            ema20_val = ema20_list[-1]
            pct_from_ema20 = (closes[-1] - ema20_val) / ema20_val
            if pct_from_ema20 > 0.02:
                score += 0.20
                trend = "uptrend"
                signals.append(f"Prijs {pct_from_ema20:.1%} boven EMA20")
            elif pct_from_ema20 < -0.02:
                score -= 0.20
                trend = "downtrend"
                signals.append(f"Prijs {pct_from_ema20:.1%} onder EMA20")

    if len(closes) >= 50:
        ema50_list = _ema(closes, 50)
        if ema50_list:
            ema50_val = ema50_list[-1]
            pct_from_ema50 = (closes[-1] - ema50_val) / ema50_val
            if pct_from_ema50 > 0.05:
                score += 0.10
                signals.append(f"Prijs {pct_from_ema50:.1%} boven EMA50")
            elif pct_from_ema50 < -0.05:
                score -= 0.10
                signals.append(f"Prijs {pct_from_ema50:.1%} onder EMA50")
            # EMA20 > EMA50 = golden cross territory
            if ema20_val and ema20_val > ema50_val:
                score += 0.05
                signals.append("EMA20 > EMA50 (bullish alignment)")
            elif ema20_val and ema20_val < ema50_val:
                score -= 0.05

    # Volume analysis
    volume_signal = "normal"
    if len(volumes) >= 10:
        avg_vol = sum(volumes[-10:-1]) / 9
        last_vol = volumes[-1]
        if avg_vol > 0:
            vol_ratio = last_vol / avg_vol
            if vol_ratio > 2.0:
                score += 0.15 if score > 0 else -0.15
                volume_signal = "high"
                signals.append(f"Volume {vol_ratio:.1f}x gemiddelde")
            elif vol_ratio < 0.5:
                volume_signal = "low"

    # Clamp score
    score = max(-1.0, min(1.0, score))

    # Classify setup type for prompt context
    setup_type = "none"
    if rsi is not None:
        if rsi < 40 and trend in ("downtrend", "sideways"):
            setup_type = "oversold_bounce"
        elif rsi > 70:
            setup_type = "overbought"
        elif 45 <= rsi <= 65 and macd_signal in ("bullish_cross", "bullish") and trend == "uptrend":
            setup_type = "momentum_breakout"

    summary = " | ".join(signals) if signals else "Geen duidelijke technische signalen"

    return TAResult(
        score=score,
        rsi=rsi,
        macd_signal=macd_signal,
        trend=trend,
        volume_signal=volume_signal,
        summary=summary,
        ema20=round(ema20_val, 4) if ema20_val else None,
        ema50=round(ema50_val, 4) if ema50_val else None,
        pct_from_ema20=round(pct_from_ema20 * 100, 2) if pct_from_ema20 else None,
        pct_from_ema50=round(pct_from_ema50 * 100, 2) if pct_from_ema50 else None,
        setup_type=setup_type,
    )

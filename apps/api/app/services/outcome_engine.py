from datetime import datetime, timezone

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.candles import Candle
from app.models.outcomes import SignalOutcome
from app.models.signals import Signal


def price_return_pct(entry: float | None, exit_price: float | None) -> float | None:
    if not entry or exit_price is None:
        return None
    return ((exit_price - entry) / entry) * 100


def signed_return_pct(entry: float | None, exit_price: float | None, direction: str) -> float | None:
    value = price_return_pct(entry, exit_price)
    if value is None:
        return None
    return -value if direction.lower() in {"sell", "short"} else value


def calculate_excursions(entry: float | None, bars: list[Candle], direction: str) -> tuple[float | None, float | None]:
    if not entry or not bars:
        return None, None
    if direction.lower() in {"sell", "short"}:
        favourable = [((entry - bar.low) / entry) * 100 for bar in bars]
        adverse = [((entry - bar.high) / entry) * 100 for bar in bars]
    else:
        favourable = [((bar.high - entry) / entry) * 100 for bar in bars]
        adverse = [((bar.low - entry) / entry) * 100 for bar in bars]
    return max(favourable), min(adverse)


class OutcomeEngine:
    """Scores past signals against later daily bars without executing trades."""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def evaluate_signals(self, limit: int = 500) -> dict:
        result = await self.db.execute(
            select(Signal).where(Signal.created_at.is_not(None)).order_by(desc(Signal.created_at)).limit(limit)
        )
        signals = result.scalars().all()
        updated = complete = partial = pending = 0

        for signal in signals:
            outcome = await self._evaluate_signal(signal)
            if outcome is None:
                continue
            updated += 1
            if outcome.outcome_status == "complete":
                complete += 1
            elif outcome.outcome_status == "partial":
                partial += 1
            else:
                pending += 1

        await self.db.commit()
        return {
            "signals_considered": len(signals),
            "outcomes_updated": updated,
            "complete": complete,
            "partial": partial,
            "pending": pending,
        }

    async def _evaluate_signal(self, signal: Signal) -> SignalOutcome | None:
        if signal.created_at is None:
            return None

        result = await self.db.execute(
            select(Candle).where(
                Candle.symbol == signal.asset,
                Candle.timeframe == "1Day",
            ).order_by(Candle.timestamp.asc())
        )
        candles = result.scalars().all()
        future_bars = [bar for bar in candles if bar.timestamp.date() > signal.created_at.date()]

        existing = await self.db.execute(select(SignalOutcome).where(SignalOutcome.signal_id == signal.id))
        outcome = existing.scalar_one_or_none()
        if outcome is None:
            outcome = SignalOutcome(
                signal_id=signal.id,
                symbol=signal.asset,
                direction=signal.direction,
                signal_created_at=signal.created_at,
            )
            self.db.add(outcome)

        entry_price = signal.suggested_entry
        entry_source = "suggested_entry"
        if entry_price is None:
            baseline = [bar for bar in candles if bar.timestamp.date() <= signal.created_at.date()]
            if baseline:
                entry_price = baseline[-1].close
                entry_source = "latest_close_before_signal"

        outcome.entry_price = entry_price
        outcome.entry_source = entry_source
        outcome.evaluated_at = datetime.now(timezone.utc)
        outcome.details = {"available_future_daily_bars": len(future_bars)}

        if entry_price is None or not future_bars:
            outcome.outcome_status = "pending"
            return outcome

        one_day = future_bars[0]
        five_day = future_bars[4] if len(future_bars) >= 5 else None
        outcome.return_1d = price_return_pct(entry_price, one_day.close)
        outcome.pnl_1d_pct = signed_return_pct(entry_price, one_day.close, signal.direction)
        outcome.return_5d = price_return_pct(entry_price, five_day.close) if five_day else None
        outcome.pnl_5d_pct = signed_return_pct(entry_price, five_day.close, signal.direction) if five_day else None
        outcome.mfe_pct, outcome.mae_pct = calculate_excursions(entry_price, future_bars[:5], signal.direction)
        outcome.outcome_status = "complete" if five_day else "partial"

        if five_day:
            benchmark_return = await self._benchmark_return(signal.created_at, five_day.timestamp)
            outcome.benchmark_return_5d = benchmark_return
            if benchmark_return is not None and outcome.pnl_5d_pct is not None:
                outcome.excess_return_5d = outcome.pnl_5d_pct - benchmark_return
        return outcome

    async def _benchmark_return(self, signal_time: datetime, end_time: datetime) -> float | None:
        result = await self.db.execute(
            select(Candle).where(Candle.symbol == "SPY", Candle.timeframe == "1Day")
            .order_by(Candle.timestamp.asc())
        )
        bars = result.scalars().all()
        baseline = [bar for bar in bars if bar.timestamp.date() <= signal_time.date()]
        exits = [bar for bar in bars if bar.timestamp.date() >= end_time.date()]
        if not baseline or not exits:
            return None
        return price_return_pct(baseline[-1].close, exits[0].close)

    async def summary(self) -> dict:
        result = await self.db.execute(select(SignalOutcome).order_by(desc(SignalOutcome.signal_created_at)))
        outcomes = result.scalars().all()
        completed = [o for o in outcomes if o.pnl_5d_pct is not None]
        one_day = [o for o in outcomes if o.pnl_1d_pct is not None]
        excess = [o.excess_return_5d for o in completed if o.excess_return_5d is not None]

        def average(values: list[float]) -> float | None:
            return sum(values) / len(values) if values else None

        return {
            "tracked": len(outcomes),
            "evaluated_1d": len(one_day),
            "evaluated_5d": len(completed),
            "pending": len([o for o in outcomes if o.outcome_status == "pending"]),
            "hit_rate_5d": (
                len([o for o in completed if o.pnl_5d_pct > 0]) / len(completed) * 100 if completed else None
            ),
            "avg_pnl_1d_pct": average([o.pnl_1d_pct for o in one_day]),
            "avg_pnl_5d_pct": average([o.pnl_5d_pct for o in completed]),
            "avg_excess_return_5d": average(excess),
        }

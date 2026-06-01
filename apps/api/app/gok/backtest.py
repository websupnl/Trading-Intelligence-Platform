import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.database import AsyncSessionLocal
from app.models.candles import Candle
from app.models.news import NewsItem
from app.models.social import SocialPost
from app.services.technical_analysis import analyze as ta_analyze
from app.gok.strategies import get_strategy, StrategyConfig
from app.gok.risk import calculate_atr, calculate_tp_sl
from app.gok.schemas import BacktestResult

logger = logging.getLogger(__name__)


async def run_backtest(strategy_name: str, lookback_days: int = 30) -> BacktestResult:
    """Replay historische data voor een strategie en simuleer gok trades."""
    strategy = get_strategy(strategy_name)
    if not strategy:
        raise ValueError(f"Onbekende strategie: {strategy_name}")

    since = datetime.now(timezone.utc) - timedelta(days=lookback_days)

    # Haal assets op die in deze periode data hebben
    async with AsyncSessionLocal() as db:
        # Gebruik recente news tickers als proxy voor relevante assets
        news_result = await db.execute(
            select(NewsItem.tickers).where(
                NewsItem.published_at >= since,
                NewsItem.ai_analyzed == True,
                NewsItem.impact_score >= strategy.min_news_impact,
            ).limit(500)
        )
        news_rows = news_result.scalars().all()

    # Verzamel unieke tickers
    tickers: set[str] = set()
    for tickers_json in news_rows:
        if tickers_json:
            for t in tickers_json:
                if 2 <= len(t) <= 10:
                    tickers.add(t)

    if not tickers:
        return BacktestResult(
            strategy=strategy_name,
            lookback_days=lookback_days,
            total_trades=0, wins=0, losses=0, win_rate=0.0,
            total_pnl=0.0, max_drawdown=0.0, avg_pnl_per_trade=0.0,
            equity_curve=[], trades=[],
        )

    trades = []
    equity = 100.0  # start met €100 fictief
    equity_curve = [{"date": since.isoformat(), "equity": equity}]
    max_equity = equity
    max_drawdown = 0.0

    for ticker in list(tickers)[:20]:
        async with AsyncSessionLocal() as db:
            candle_result = await db.execute(
                select(Candle).where(
                    Candle.symbol == ticker,
                    Candle.timestamp >= since,
                    Candle.timeframe.in_(["15Min", "1Day"]),
                )
                .order_by(Candle.timestamp.asc())
                .limit(200)
            )
            candles = candle_result.scalars().all()

        if len(candles) < 20:
            continue

        # Simuleer trades via rolling window
        for i in range(20, len(candles) - 5):
            window = candles[:i]
            ta = ta_analyze(window)

            if ta.score < strategy.min_ta_score:
                continue

            atr = calculate_atr(window, 14)
            if not atr:
                continue

            entry = candles[i].close
            tp, sl = calculate_tp_sl(entry, atr, strategy)

            # Simuleer forward: kijk of TP of SL bereikt wordt
            outcome = None
            pnl_pct = 0.0
            for future in candles[i + 1: i + 1 + strategy.max_hold_hours * 4]:
                if future.high >= tp:
                    outcome = "win"
                    pnl_pct = (tp - entry) / entry * 100
                    break
                elif future.low <= sl:
                    outcome = "loss"
                    pnl_pct = (sl - entry) / entry * 100
                    break

            if outcome is None:
                outcome = "neutral"
                pnl_pct = (candles[min(i + strategy.max_hold_hours * 4, len(candles) - 1)].close - entry) / entry * 100

            pnl_eur = pnl_pct / 100 * 50  # fictief €50 per trade
            equity += pnl_eur
            max_equity = max(max_equity, equity)
            drawdown = (max_equity - equity) / max_equity * 100
            max_drawdown = max(max_drawdown, drawdown)

            equity_curve.append({
                "date": candles[i].timestamp.isoformat() if hasattr(candles[i].timestamp, 'isoformat') else str(candles[i].timestamp),
                "equity": round(equity, 2),
            })

            trades.append({
                "asset": ticker,
                "date": str(candles[i].timestamp),
                "entry": round(entry, 4),
                "tp": round(tp, 4),
                "sl": round(sl, 4),
                "outcome": outcome,
                "pnl_pct": round(pnl_pct, 2),
                "pnl_eur": round(pnl_eur, 2),
            })

            # Max 2 trades per asset per backtest
            if len([t for t in trades if t["asset"] == ticker]) >= 2:
                break

    wins = [t for t in trades if t["outcome"] == "win"]
    losses = [t for t in trades if t["outcome"] == "loss"]
    total = len(trades)
    total_pnl = sum(t["pnl_eur"] for t in trades)
    avg_pnl = total_pnl / total if total > 0 else 0.0

    return BacktestResult(
        strategy=strategy_name,
        lookback_days=lookback_days,
        total_trades=total,
        wins=len(wins),
        losses=len(losses),
        win_rate=round(len(wins) / total, 4) if total > 0 else 0.0,
        total_pnl=round(total_pnl, 2),
        max_drawdown=round(max_drawdown, 2),
        avg_pnl_per_trade=round(avg_pnl, 2),
        equity_curve=equity_curve[-100:],  # max 100 punten
        trades=trades[-50:],  # max 50 trades
    )

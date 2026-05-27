"""
Real-time SSE stream for the Live Session page.
Pushes: prices, signals, AI activity, portfolio, pipeline status.
"""
import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import AsyncGenerator
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from sqlalchemy import select, desc
from app.database import AsyncSessionLocal
from app.models.signals import Signal
from app.models.audit import AuditLog
from app.models.candles import Candle
from app.config import get_settings

router = APIRouter(prefix="/api/stream")
logger = logging.getLogger(__name__)
settings = get_settings()


def _event(event_type: str, data: dict) -> str:
    """Format an SSE event."""
    payload = json.dumps({**data, "type": event_type, "ts": datetime.now(timezone.utc).isoformat()})
    return f"data: {payload}\n\n"


async def _get_latest_price(symbol: str) -> dict | None:
    """Get latest candle data from DB."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Candle)
                .where(Candle.symbol == symbol)
                .order_by(desc(Candle.timestamp))
                .limit(1)
            )
            candle = result.scalar_one_or_none()
            if candle:
                return {
                    "symbol": symbol,
                    "price": candle.close,
                    "open": candle.open,
                    "high": candle.high,
                    "low": candle.low,
                    "volume": candle.volume,
                    "timestamp": candle.timestamp.isoformat(),
                }
    except Exception:
        pass
    return None


async def _get_candles_for_chart(symbol: str, timeframe: str = "1Day", limit: int = 60) -> list:
    """Get candles for chart rendering."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Candle)
                .where(Candle.symbol == symbol, Candle.timeframe == timeframe)
                .order_by(Candle.timestamp.asc())
                .limit(limit)
            )
            candles = result.scalars().all()
            return [
                {
                    "time": int(c.timestamp.timestamp()),
                    "open": c.open,
                    "high": c.high,
                    "low": c.low,
                    "close": c.close,
                    "volume": c.volume,
                }
                for c in candles
            ]
    except Exception:
        return []


async def _get_pending_signals() -> list:
    """Get pending signals."""
    try:
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(Signal)
                .where(Signal.status == "pending")
                .order_by(desc(Signal.confidence))
                .limit(10)
            )
            signals = result.scalars().all()
            return [
                {
                    "id": s.id,
                    "asset": s.asset,
                    "direction": s.direction,
                    "confidence": s.confidence,
                    "reason": s.reason,
                    "suggested_entry": s.suggested_entry,
                    "suggested_stop": s.suggested_stop,
                    "suggested_take_profit": s.suggested_take_profit,
                    "risk_reward": s.risk_reward,
                    "ai_analysis": s.ai_analysis or {},
                    "created_at": s.created_at.isoformat() if s.created_at else None,
                }
                for s in signals
            ]
    except Exception:
        return []


async def _get_recent_activity(since_seconds: int = 30) -> list:
    """Get recent audit events (AI actions)."""
    try:
        since = datetime.now(timezone.utc) - timedelta(seconds=since_seconds)
        async with AsyncSessionLocal() as db:
            result = await db.execute(
                select(AuditLog)
                .where(AuditLog.created_at >= since)
                .order_by(desc(AuditLog.created_at))
                .limit(5)
            )
            logs = result.scalars().all()
            return [
                {
                    "action": l.action,
                    "actor": l.actor,
                    "message": l.message,
                    "status": l.status,
                    "entity_type": l.entity_type,
                    "details": l.details,
                    "created_at": l.created_at.isoformat() if l.created_at else None,
                }
                for l in logs
            ]
    except Exception:
        return []


async def _get_alpaca_snapshot() -> dict | None:
    """Quick Alpaca account snapshot."""
    if not settings.alpaca_configured:
        return None
    try:
        import httpx
        headers = {
            "APCA-API-KEY-ID": settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": settings.alpaca_secret_key,
        }
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{settings.alpaca_base_url}/v2/account", headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                return {
                    "equity": float(data.get("equity", 0)),
                    "cash": float(data.get("cash", 0)),
                    "buying_power": float(data.get("buying_power", 0)),
                    "day_pnl": float(data.get("equity", 0)) - float(data.get("last_equity", data.get("equity", 0))),
                }
    except Exception:
        pass
    return None


async def session_stream(symbols: list[str]) -> AsyncGenerator[str, None]:
    """
    Main SSE generator. Yields events every ~4 seconds.
    """
    # Initial burst: send chart data for all symbols
    for symbol in symbols[:3]:
        candles = await _get_candles_for_chart(symbol)
        if candles:
            yield _event("chart_data", {"symbol": symbol, "candles": candles})
        await asyncio.sleep(0.1)

    # Initial signals + activity
    signals = await _get_pending_signals()
    yield _event("signals", {"signals": signals})

    activity = await _get_recent_activity(since_seconds=3600)
    if activity:
        yield _event("activity_batch", {"events": activity})

    # Portfolio snapshot
    portfolio = await _get_alpaca_snapshot()
    if portfolio:
        yield _event("portfolio", portfolio)

    # Heartbeat + rolling updates
    tick = 0
    last_signal_ids = {s["id"] for s in signals}

    while True:
        try:
            await asyncio.sleep(4)
            tick += 1

            # Price update for each symbol (rotate)
            symbol = symbols[tick % len(symbols)]
            price_data = await _get_latest_price(symbol)
            if price_data:
                yield _event("price", price_data)

            # Every 4 ticks (~16s): push pending signals
            if tick % 4 == 0:
                new_signals = await _get_pending_signals()
                new_ids = {s["id"] for s in new_signals}
                added = [s for s in new_signals if s["id"] not in last_signal_ids]
                if added:
                    yield _event("new_signal", {"signal": added[0]})
                last_signal_ids = new_ids
                yield _event("signals", {"signals": new_signals})

            # Every 5 ticks (~20s): recent activity
            if tick % 5 == 0:
                activity = await _get_recent_activity(since_seconds=25)
                if activity:
                    yield _event("activity_batch", {"events": activity})

            # Every 8 ticks (~32s): portfolio update
            if tick % 8 == 0:
                portfolio = await _get_alpaca_snapshot()
                if portfolio:
                    yield _event("portfolio", portfolio)

            # Every 15 ticks (~60s): refresh chart candles
            if tick % 15 == 0:
                for sym in symbols[:2]:
                    candles = await _get_candles_for_chart(sym)
                    if candles:
                        yield _event("chart_data", {"symbol": sym, "candles": candles})

            # Heartbeat
            yield _event("heartbeat", {"tick": tick})

        except asyncio.CancelledError:
            logger.info("SSE session stream cancelled")
            break
        except Exception as e:
            logger.error(f"SSE stream fout: {e}")
            yield _event("error", {"message": str(e)})
            await asyncio.sleep(5)


@router.get("/session")
async def live_session(
    symbols: str = Query("AAPL,NVDA,TSLA", description="Komma-gescheiden symbolen"),
):
    """SSE endpoint voor Live Session pagina."""
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()][:5]
    if not symbol_list:
        symbol_list = ["AAPL"]

    return StreamingResponse(
        session_stream(symbol_list),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # Disable Nginx buffering
            "Connection": "keep-alive",
        },
    )


@router.get("/candles/{symbol}")
async def get_chart_candles(
    symbol: str,
    timeframe: str = Query("1Day"),
    limit: int = Query(100, le=300),
):
    """Get OHLCV candles for chart rendering."""
    candles = await _get_candles_for_chart(symbol.upper(), timeframe, limit)
    return {"symbol": symbol.upper(), "timeframe": timeframe, "candles": candles}

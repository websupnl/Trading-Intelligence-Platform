import asyncio
import logging
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.config import get_settings
from app.models.gok import GokPosition, GokSession
from app.models.settings import Setting
from app.gok.schemas import (
    GokStatusOut, StrategyOut, OpportunityOut, ExecuteRequest,
    GokPositionOut, GokStatsOut, BacktestRequest, BacktestResult, ClosePositionResponse,
)
from app.gok.strategies import all_strategies, get_strategy
from app.gok.scanner import GokScanner
from app.gok.engine import GokEngine
from app.gok.backtest import run_backtest
from app.gok.ws_manager import gok_ws_manager
from app.gok.risk import MAX_DAILY_GOK_TRADES

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/gok", tags=["gok"])

_monitor_task: asyncio.Task | None = None


def _ensure_monitor():
    """Start de position monitor als die nog niet draait."""
    global _monitor_task
    if _monitor_task is None or _monitor_task.done():
        from app.gok.position_monitor import monitor_loop
        _monitor_task = asyncio.create_task(monitor_loop())


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await gok_ws_manager.connect(ws)
    _ensure_monitor()
    try:
        while True:
            data = await ws.receive_text()
            import json
            try:
                msg = json.loads(data)
                if msg.get("action") == "ping":
                    await gok_ws_manager.send_to(ws, "pong", {"ts": datetime.now(timezone.utc).isoformat()})
            except Exception:
                pass
    except WebSocketDisconnect:
        await gok_ws_manager.disconnect(ws)


@router.get("/status", response_model=GokStatusOut)
async def get_status(db: AsyncSession = Depends(get_db)):
    settings = get_settings()
    engine = GokEngine()
    open_count = await engine.get_open_positions_count()
    daily_count = await engine.get_daily_trades_count()

    if settings.kill_switch_enabled:
        return GokStatusOut(
            available=False, reason="Kill switch actief",
            mode="paper", open_positions=open_count,
            daily_trades=daily_count, max_daily_trades=MAX_DAILY_GOK_TRADES,
            kill_switch=True,
        )

    mode = "paper"
    result = await db.execute(
        select(Setting).where(Setting.key == "gok_mode").limit(1)
    )
    setting = result.scalar_one_or_none()
    if setting and setting.value == "live" and settings.live_trading_enabled:
        mode = "live"

    return GokStatusOut(
        available=True,
        mode=mode,
        open_positions=open_count,
        daily_trades=daily_count,
        max_daily_trades=MAX_DAILY_GOK_TRADES,
        kill_switch=False,
    )


@router.get("/strategies", response_model=list[StrategyOut])
async def get_strategies(db: AsyncSession = Depends(get_db)):
    from app.models.gok import GokStrategy
    result = await db.execute(select(GokStrategy))
    db_strategies = {s.name: s for s in result.scalars().all()}

    out = []
    for cfg in all_strategies():
        db_s = db_strategies.get(cfg.name)
        total = db_s.total_trades if db_s else 0
        wins = db_s.wins if db_s else 0
        total_pnl = db_s.total_pnl if db_s else 0.0
        out.append(StrategyOut(
            name=cfg.name,
            display_name=cfg.display_name,
            description=cfg.description,
            atr_multiplier_tp=cfg.atr_multiplier_tp,
            atr_multiplier_sl=cfg.atr_multiplier_sl,
            max_trades_per_day=cfg.max_trades_per_day,
            max_hold_hours=cfg.max_hold_hours,
            total_trades=total,
            wins=wins,
            win_rate=round(wins / total, 4) if total > 0 else 0.0,
            total_pnl=total_pnl,
        ))
    return out


@router.get("/scan", response_model=list[OpportunityOut])
async def scan(
    strategy: str = Query(..., description="Strategie naam"),
    budget: float = Query(50.0, ge=5, le=500),
):
    scanner = GokScanner()
    try:
        opportunities = await scanner.scan(strategy_name=strategy, budget_eur=budget)
        return opportunities
    except Exception as e:
        logger.error(f"Scan fout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/execute", response_model=GokPositionOut)
async def execute(req: ExecuteRequest):
    engine = GokEngine()
    _ensure_monitor()
    try:
        return await engine.execute(req)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Execute fout: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/close/{position_id}", response_model=ClosePositionResponse)
async def close_position(position_id: str):
    engine = GokEngine()
    result = await engine.close_position(position_id, reason="manual")
    if not result:
        raise HTTPException(status_code=404, detail="Positie niet gevonden of al gesloten")
    return ClosePositionResponse(
        success=True,
        position_id=position_id,
        pnl=result.pnl,
        message=f"Positie gesloten. P&L: €{result.pnl:.2f}" if result.pnl else "Positie gesloten",
    )


@router.get("/positions", response_model=list[GokPositionOut])
async def get_open_positions(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GokPosition).where(GokPosition.status == "open")
        .order_by(GokPosition.opened_at.desc())
    )
    positions = result.scalars().all()
    return [GokPositionOut(
        id=p.id, session_id=p.session_id, strategy_name=p.strategy_name,
        asset=p.asset, side=p.side, quantity=p.quantity,
        entry_price=p.entry_price, current_price=p.current_price,
        take_profit=p.take_profit, stop_loss=p.stop_loss,
        budget_eur=p.budget_eur, pnl=p.pnl, pnl_pct=p.pnl_pct,
        mode=p.mode, status=p.status, closed_reason=p.closed_reason,
        opened_at=p.opened_at, closed_at=p.closed_at,
    ) for p in positions]


@router.get("/history", response_model=list[GokPositionOut])
async def get_history(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(GokPosition).where(GokPosition.status == "closed")
        .order_by(GokPosition.closed_at.desc())
        .limit(limit)
    )
    positions = result.scalars().all()
    return [GokPositionOut(
        id=p.id, session_id=p.session_id, strategy_name=p.strategy_name,
        asset=p.asset, side=p.side, quantity=p.quantity,
        entry_price=p.entry_price, current_price=p.current_price,
        take_profit=p.take_profit, stop_loss=p.stop_loss,
        budget_eur=p.budget_eur, pnl=p.pnl, pnl_pct=p.pnl_pct,
        mode=p.mode, status=p.status, closed_reason=p.closed_reason,
        opened_at=p.opened_at, closed_at=p.closed_at,
    ) for p in positions]


@router.get("/stats", response_model=GokStatsOut)
async def get_stats():
    engine = GokEngine()
    return await engine.get_stats()


@router.post("/backtest", response_model=BacktestResult)
async def backtest(req: BacktestRequest):
    try:
        return await run_backtest(req.strategy, req.lookback_days)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Backtest fout: {e}")
        raise HTTPException(status_code=500, detail=str(e))

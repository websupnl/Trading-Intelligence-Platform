from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.trades import Trade
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
from app.services.risk_engine import RiskEngine
from app.services.audit import AuditLogService
from app.services.trade_tracker import TradeTrackerService
from app.schemas.orders import PaperOrderRequest, CancelOrderRequest
from app.schemas.risk import RiskCheckRequest

router = APIRouter(prefix="/api/trading")
broker = AlpacaBroker()
risk_engine = RiskEngine()


# ─── Account & Positions ─────────────────────────────────────────────────────

@router.get("/account")
async def get_account():
    try:
        return await broker.get_account()
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail={"status": "not_configured", "message": str(e)})
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail={"status": "api_error", "message": str(e)})


@router.get("/positions")
async def get_positions():
    try:
        return await broker.get_positions()
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail={"status": "not_configured", "message": str(e)})
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail={"status": "api_error", "message": str(e)})


@router.get("/orders")
async def get_orders(status: str = "open"):
    try:
        return await broker.get_orders(status=status)
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail={"status": "not_configured", "message": str(e)})
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail={"status": "api_error", "message": str(e)})


@router.get("/portfolio-history")
async def get_portfolio_history(period: str = "1M"):
    try:
        return await broker.get_portfolio_history(period=period)
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail={"status": "not_configured", "message": str(e)})
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail={"status": "api_error", "message": str(e)})


# ─── Quote (live price) ───────────────────────────────────────────────────────

@router.get("/quote/{symbol}")
async def get_quote(symbol: str):
    """Get latest price for a symbol from Alpaca or DB."""
    from app.services.market_data_service import MarketDataService
    svc = MarketDataService()
    price = await svc.get_latest_price(symbol.upper())
    if price is None:
        raise HTTPException(status_code=404, detail=f"Geen prijs gevonden voor {symbol}")
    return {"symbol": symbol.upper(), "price": price}


# ─── Manual order ─────────────────────────────────────────────────────────────

@router.post("/orders/paper")
async def submit_paper_order(req: PaperOrderRequest, db: AsyncSession = Depends(get_db)):
    audit = AuditLogService(db)

    risk_req = RiskCheckRequest(
        symbol=req.symbol,
        side=req.side,
        quantity=req.quantity or 0,
        estimated_notional=req.notional,
        signal_id=req.signal_id,
        stop_loss=req.stop_loss,
        mode="paper",
    )
    risk_result = risk_engine.check(risk_req)

    await audit.log("order_attempt", entity_type="order", details={
        "symbol": req.symbol,
        "side": req.side,
        "risk_approved": risk_result.approved,
        "actor": "user_manual",
    })

    if not risk_result.approved:
        await audit.log("order_rejected", entity_type="order", details={
            "symbol": req.symbol,
            "reasons": risk_result.reasons,
        }, status="rejected")
        raise HTTPException(status_code=422, detail={
            "status": "risk_rejected",
            "reasons": risk_result.reasons,
            "warnings": risk_result.warnings,
        })

    if risk_result.required_manual_approval:
        return {
            "status": "requires_manual_approval",
            "risk_result": risk_result.model_dump(),
            "message": "Order vereist handmatige bevestiging",
        }

    try:
        result = await broker.submit_order(
            symbol=req.symbol,
            qty=req.quantity,
            notional=req.notional,
            side=req.side,
            order_type=req.order_type,
            limit_price=req.limit_price,
        )
        await audit.log("order_submitted", entity_type="order", details={
            "symbol": req.symbol,
            "side": req.side,
            "actor": "user_manual",
        }, message=f"Handmatige order: {req.symbol} {req.side}")
        return {"status": "submitted", "order": result, "risk_result": risk_result.model_dump()}
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail={"status": "not_configured", "message": str(e)})
    except AlpacaAPIError as e:
        await audit.log("order_failed", status="error", message=str(e))
        raise HTTPException(status_code=502, detail={"status": "api_error", "message": str(e)})


@router.post("/orders/cancel")
async def cancel_order(req: CancelOrderRequest, db: AsyncSession = Depends(get_db)):
    audit = AuditLogService(db)
    try:
        ok = await broker.cancel_order(req.alpaca_order_id)
        await audit.log("order_cancelled", entity_type="order", entity_id=req.alpaca_order_id)
        return {"status": "cancelled" if ok else "failed"}
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))


# ─── Close position ───────────────────────────────────────────────────────────

@router.post("/close-position/{symbol}")
async def close_position(symbol: str, db: AsyncSession = Depends(get_db)):
    """Market-sell an entire open position."""
    audit = AuditLogService(db)
    try:
        # Get current position qty from Alpaca
        positions = await broker.get_positions()
        pos = next((p for p in positions if p.get("symbol") == symbol.upper()), None)
        if not pos:
            raise HTTPException(status_code=404, detail=f"Geen open positie voor {symbol}")

        qty = float(pos.get("qty", 0))
        if qty <= 0:
            raise HTTPException(status_code=400, detail="Qty is 0 of negatief")

        result = await broker.submit_order(
            symbol=symbol.upper(),
            qty=qty,
            notional=None,
            side="sell",
            order_type="market",
        )
        await audit.log(
            "position_closed_manually",
            actor="user",
            entity_type="position",
            entity_id=symbol.upper(),
            details={"symbol": symbol.upper(), "qty": qty},
            message=f"Positie gesloten: {symbol.upper()} qty={qty}",
        )
        return {"status": "submitted", "order": result, "qty": qty}
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AlpacaAPIError as e:
        await audit.log("position_close_failed", status="error", message=str(e))
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/close-all")
async def close_all_positions(db: AsyncSession = Depends(get_db)):
    """Emergency: close all open positions."""
    audit = AuditLogService(db)
    try:
        positions = await broker.get_positions()
        results = []
        for pos in positions:
            symbol = pos.get("symbol")
            qty = float(pos.get("qty", 0))
            if not symbol or qty <= 0:
                continue
            try:
                order = await broker.submit_order(symbol=symbol, qty=qty, notional=None, side="sell")
                results.append({"symbol": symbol, "qty": qty, "status": "submitted"})
            except Exception as e:
                results.append({"symbol": symbol, "status": "failed", "error": str(e)})

        await audit.log(
            "all_positions_closed",
            actor="user",
            details={"count": len(results), "results": results},
            message=f"Noodsluiting: {len(results)} posities gesloten",
        )
        return {"status": "done", "closed": len(results), "results": results}
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))


# ─── Trade history & performance ──────────────────────────────────────────────

@router.get("/trades")
async def get_trades(limit: int = Query(100, le=500), db: AsyncSession = Depends(get_db)):
    """Get trade history from DB."""
    result = await db.execute(
        select(Trade).order_by(desc(Trade.created_at)).limit(limit)
    )
    trades = result.scalars().all()
    return [
        {
            "id": t.id,
            "symbol": t.symbol,
            "side": t.side,
            "quantity": t.quantity,
            "entry_price": t.entry_price,
            "exit_price": t.exit_price,
            "stop_loss": t.stop_loss,
            "take_profit": t.take_profit,
            "pnl": t.pnl,
            "pnl_pct": t.pnl_pct,
            "mode": t.mode,
            "status": t.status,
            "entry_reason": t.entry_reason,
            "exit_reason": t.exit_reason,
            "ai_reflection": t.ai_reflection,
            "opened_at": t.opened_at,
            "closed_at": t.closed_at,
            "signal_id": t.signal_id,
        }
        for t in trades
    ]


@router.get("/performance")
async def get_performance():
    """Get performance statistics from closed trades."""
    svc = TradeTrackerService()
    return await svc.get_performance_stats()


@router.post("/sync-trades")
async def sync_trades(db: AsyncSession = Depends(get_db)):
    """Manually trigger trade sync from Alpaca."""
    audit = AuditLogService(db)
    svc = TradeTrackerService()
    created = await svc.sync_open_trades_from_orders()
    closed = await svc.sync_closed_trades()
    await audit.log("trades_synced_manually", actor="user",
                    details={"created": created, "closed": closed})
    return {"status": "ok", "created": created, "closed": closed}

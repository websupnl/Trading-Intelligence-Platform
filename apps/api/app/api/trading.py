from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from app.database import get_db
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
from app.services.risk_engine import RiskEngine
from app.services.audit import AuditLogService
from app.schemas.orders import PaperOrderRequest, CancelOrderRequest
from app.schemas.risk import RiskCheckRequest

router = APIRouter(prefix="/api/trading")
broker = AlpacaBroker()
risk_engine = RiskEngine()


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
        await audit.log("order_submitted", entity_type="order", details={"symbol": req.symbol, "side": req.side})
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

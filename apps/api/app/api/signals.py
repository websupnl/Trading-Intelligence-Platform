from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc
from app.database import get_db
from app.models.signals import Signal
from app.services.risk_engine import RiskEngine
from app.services.alpaca_broker import AlpacaBroker, AlpacaNotConfiguredError, AlpacaAPIError
from app.schemas.risk import RiskCheckRequest
from app.services.order_recorder import record_submitted_order
from app.services.notifications import NotificationService

router = APIRouter(prefix="/api/signals")
risk_engine = RiskEngine()
broker = AlpacaBroker()


@router.get("")
async def get_signals(limit: int = Query(50, le=200), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Signal).order_by(desc(Signal.created_at)).limit(limit))
    items = result.scalars().all()
    return [{"id": i.id, "asset": i.asset, "direction": i.direction, "confidence": i.confidence,
             "reason": i.reason, "status": i.status, "risk_reward": i.risk_reward,
             "suggested_entry": i.suggested_entry, "suggested_stop": i.suggested_stop,
             "suggested_take_profit": i.suggested_take_profit, "ai_analysis": i.ai_analysis,
             "risk_check_result": i.risk_check_result, "created_at": i.created_at}
            for i in items]


@router.post("/{signal_id}/paper-trade")
async def paper_trade_signal(signal_id: str, confirmed: bool = False, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Signal).where(Signal.id == signal_id))
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal niet gevonden")

    risk_req = RiskCheckRequest(
        symbol=signal.asset,
        side=signal.direction,
        quantity=1,
        confidence=signal.confidence,
        stop_loss=signal.suggested_stop,
        mode="paper",
        estimated_notional=signal.suggested_entry,
    )
    risk_result = await risk_engine.check_async(risk_req)

    if not risk_result.approved:
        signal.status = "risk_rejected"
        await db.commit()
        raise HTTPException(status_code=422, detail={"status": "risk_rejected", "reasons": risk_result.reasons})

    if risk_result.required_manual_approval and not confirmed:
        signal.risk_check_result = risk_result.model_dump()
        await db.commit()
        return {
            "status": "requires_manual_approval",
            "risk_result": risk_result.model_dump(),
            "message": "Bevestig de paper trade expliciet.",
        }

    try:
        # Use notional ($50) instead of qty=1 so low-priced coins don't get rejected
        from app.services.auto_trader import AutoTraderService
        trade_notional = 50.0
        try:
            trade_notional = await AutoTraderService()._get_notional()
        except Exception:
            pass
        order = await broker.submit_order(
            symbol=signal.asset,
            qty=None,
            notional=trade_notional,
            side=signal.direction,
            stop_price=signal.suggested_stop,
        )
        record_submitted_order(
            db,
            symbol=signal.asset,
            side=signal.direction,
            quantity=None,
            notional=trade_notional,
            order_type="market",
            mode="paper",
            broker_response=order,
            signal_id=signal.id,
            stop_price=signal.suggested_stop,
            risk_check_result=risk_result.model_dump(),
        )
        signal.status = "paper_traded"
        signal.risk_check_result = risk_result.model_dump()
        await db.commit()
        await NotificationService(db).send(
            "signal_paper_traded",
            f"Trading OS - Signal paper trade: {signal.asset} {signal.direction.upper()}",
            f"Bevestigd signaal uitgevoerd in paper mode. Confidence: {signal.confidence:.0%}.",
            severity="warning",
            entity_type="signal",
            entity_id=signal.id,
        )
        return {"status": "paper_traded", "order": order}
    except AlpacaNotConfiguredError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except AlpacaAPIError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post("/{signal_id}/reject")
async def reject_signal(signal_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Signal).where(Signal.id == signal_id))
    signal = result.scalar_one_or_none()
    if not signal:
        raise HTTPException(status_code=404, detail="Signal niet gevonden")
    signal.status = "rejected"
    await db.commit()
    return {"status": "rejected"}

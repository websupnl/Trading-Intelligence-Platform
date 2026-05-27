from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.orders import Order


def record_submitted_order(
    db: AsyncSession,
    *,
    symbol: str,
    side: str,
    quantity: float | None,
    notional: float | None,
    order_type: str,
    mode: str,
    broker_response: dict,
    signal_id: str | None = None,
    stop_price: float | None = None,
    limit_price: float | None = None,
    risk_check_result: dict | None = None,
) -> Order:
    """Create the audit-friendly local order record after broker submission."""
    filled_price = broker_response.get("filled_avg_price")
    filled_qty = broker_response.get("filled_qty")
    order = Order(
        alpaca_order_id=broker_response.get("id"),
        signal_id=signal_id,
        symbol=symbol.upper(),
        side=side,
        order_type=order_type,
        quantity=quantity or 0.0,
        notional=notional,
        limit_price=limit_price,
        stop_price=stop_price,
        filled_price=float(filled_price) if filled_price else None,
        filled_qty=float(filled_qty) if filled_qty else None,
        mode=mode,
        status=broker_response.get("status", "submitted"),
        risk_check_result=risk_check_result,
        alpaca_response=broker_response,
        submitted_at=datetime.now(timezone.utc),
    )
    db.add(order)
    return order

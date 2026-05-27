from pydantic import BaseModel
from typing import Optional


class PaperOrderRequest(BaseModel):
    symbol: str
    side: str
    quantity: Optional[float] = None
    notional: Optional[float] = None
    order_type: str = "market"
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None
    signal_id: Optional[str] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    confirmed: bool = False


class CancelOrderRequest(BaseModel):
    alpaca_order_id: str

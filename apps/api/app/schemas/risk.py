from pydantic import BaseModel
from typing import Optional


class RiskCheckRequest(BaseModel):
    symbol: str
    side: str
    quantity: Optional[float] = None
    estimated_notional: Optional[float] = None
    signal_id: Optional[str] = None
    confidence: Optional[float] = None
    stop_loss: Optional[float] = None
    mode: str = "paper"


class RiskCheckResult(BaseModel):
    approved: bool
    required_manual_approval: bool
    reasons: list[str]
    warnings: list[str]
    max_position_size: Optional[float] = None
    blocked_by_rule: Optional[str] = None

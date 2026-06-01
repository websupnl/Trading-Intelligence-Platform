from datetime import datetime
from typing import Optional
from pydantic import BaseModel


class StrategyOut(BaseModel):
    name: str
    display_name: str
    description: str
    atr_multiplier_tp: float
    atr_multiplier_sl: float
    max_trades_per_day: int
    max_hold_hours: int
    total_trades: int = 0
    wins: int = 0
    win_rate: float = 0.0
    total_pnl: float = 0.0


class OpportunityOut(BaseModel):
    asset: str
    strategy: str
    score: float
    confidence: float
    entry_price: float
    take_profit: float
    stop_loss: float
    atr: float
    reason: str
    news_score: float = 0.0
    social_score: float = 0.0
    ta_score: float = 0.0
    news_headlines: list[str] = []


class GokStatusOut(BaseModel):
    available: bool
    reason: Optional[str] = None
    mode: str
    open_positions: int
    daily_trades: int
    max_daily_trades: int
    kill_switch: bool


class ExecuteRequest(BaseModel):
    asset: str
    strategy: str
    budget_eur: float
    entry_price: float
    take_profit: float
    stop_loss: float
    atr: float
    opportunity_data: dict = {}


class GokPositionOut(BaseModel):
    id: str
    session_id: Optional[str]
    strategy_name: str
    asset: str
    side: str
    quantity: float
    entry_price: float
    current_price: Optional[float]
    take_profit: Optional[float]
    stop_loss: Optional[float]
    budget_eur: float
    pnl: Optional[float]
    pnl_pct: Optional[float]
    mode: str
    status: str
    closed_reason: Optional[str]
    opened_at: Optional[datetime]
    closed_at: Optional[datetime]

    class Config:
        from_attributes = True


class GokStatsOut(BaseModel):
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    total_pnl: float
    best_trade_pnl: float
    worst_trade_pnl: float
    current_streak: int
    daily_score: int
    open_positions: int


class BacktestRequest(BaseModel):
    strategy: str
    lookback_days: int = 30


class BacktestResult(BaseModel):
    strategy: str
    lookback_days: int
    total_trades: int
    wins: int
    losses: int
    win_rate: float
    total_pnl: float
    max_drawdown: float
    avg_pnl_per_trade: float
    equity_curve: list[dict]
    trades: list[dict]


class ClosePositionResponse(BaseModel):
    success: bool
    position_id: str
    pnl: Optional[float]
    message: str

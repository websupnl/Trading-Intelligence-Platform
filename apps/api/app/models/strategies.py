from sqlalchemy import String, Float, Integer, Text, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class StrategyPerformance(Base, TimestampMixin):
    __tablename__ = "strategy_performance"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    strategy_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    total_trades: Mapped[int] = mapped_column(Integer, default=0)
    winning_trades: Mapped[int] = mapped_column(Integer, default=0)
    losing_trades: Mapped[int] = mapped_column(Integer, default=0)
    win_rate: Mapped[float] = mapped_column(Float, nullable=True)
    avg_pnl: Mapped[float] = mapped_column(Float, nullable=True)
    total_pnl: Mapped[float] = mapped_column(Float, default=0.0)
    avg_rr: Mapped[float] = mapped_column(Float, nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    strategy_metadata: Mapped[dict] = mapped_column(JSON, nullable=True)

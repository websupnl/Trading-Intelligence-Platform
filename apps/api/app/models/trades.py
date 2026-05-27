from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Trade(Base, TimestampMixin):
    __tablename__ = "trades"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    signal_id: Mapped[str] = mapped_column(String, nullable=True)
    order_id: Mapped[str] = mapped_column(String, nullable=True)
    alpaca_order_id: Mapped[str] = mapped_column(String, nullable=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    side: Mapped[str] = mapped_column(String(10), nullable=False)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=True)
    exit_price: Mapped[float] = mapped_column(Float, nullable=True)
    stop_loss: Mapped[float] = mapped_column(Float, nullable=True)
    take_profit: Mapped[float] = mapped_column(Float, nullable=True)
    pnl: Mapped[float] = mapped_column(Float, nullable=True)
    pnl_pct: Mapped[float] = mapped_column(Float, nullable=True)
    mode: Mapped[str] = mapped_column(String(10), default="paper")
    status: Mapped[str] = mapped_column(String(20), default="open")
    entry_reason: Mapped[str] = mapped_column(Text, nullable=True)
    exit_reason: Mapped[str] = mapped_column(Text, nullable=True)
    ai_reflection: Mapped[dict] = mapped_column(JSON, nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    memory_file_path: Mapped[str] = mapped_column(String(500), nullable=True)

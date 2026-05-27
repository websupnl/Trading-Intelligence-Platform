from datetime import datetime
import uuid

from sqlalchemy import DateTime, Float, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class SignalOutcome(Base, TimestampMixin):
    __tablename__ = "signal_outcomes"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    signal_id: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    signal_created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entry_price: Mapped[float] = mapped_column(Float, nullable=True)
    entry_source: Mapped[str] = mapped_column(String(40), default="suggested_entry")
    return_1d: Mapped[float] = mapped_column(Float, nullable=True)
    return_5d: Mapped[float] = mapped_column(Float, nullable=True)
    pnl_1d_pct: Mapped[float] = mapped_column(Float, nullable=True)
    pnl_5d_pct: Mapped[float] = mapped_column(Float, nullable=True)
    mfe_pct: Mapped[float] = mapped_column(Float, nullable=True)
    mae_pct: Mapped[float] = mapped_column(Float, nullable=True)
    benchmark_symbol: Mapped[str] = mapped_column(String(20), default="SPY")
    benchmark_return_5d: Mapped[float] = mapped_column(Float, nullable=True)
    excess_return_5d: Mapped[float] = mapped_column(Float, nullable=True)
    outcome_status: Mapped[str] = mapped_column(String(20), default="pending")
    evaluated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, nullable=True)

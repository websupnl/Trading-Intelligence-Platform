from datetime import datetime
from sqlalchemy import String, Float, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Position(Base, TimestampMixin):
    __tablename__ = "positions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    avg_entry_price: Mapped[float] = mapped_column(Float, nullable=False)
    current_price: Mapped[float] = mapped_column(Float, nullable=True)
    market_value: Mapped[float] = mapped_column(Float, nullable=True)
    unrealized_pnl: Mapped[float] = mapped_column(Float, nullable=True)
    unrealized_pnl_pct: Mapped[float] = mapped_column(Float, nullable=True)
    side: Mapped[str] = mapped_column(String(10), default="long")
    mode: Mapped[str] = mapped_column(String(10), default="paper")
    status: Mapped[str] = mapped_column(String(20), default="open")
    last_synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

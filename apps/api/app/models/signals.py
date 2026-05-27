from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Signal(Base, TimestampMixin):
    __tablename__ = "signals"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    asset: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)
    timeframe: Mapped[str] = mapped_column(String(20), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    invalidation_level: Mapped[float] = mapped_column(Float, nullable=True)
    suggested_entry: Mapped[float] = mapped_column(Float, nullable=True)
    suggested_stop: Mapped[float] = mapped_column(Float, nullable=True)
    suggested_take_profit: Mapped[float] = mapped_column(Float, nullable=True)
    risk_reward: Mapped[float] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    risk_check_result: Mapped[dict] = mapped_column(JSON, nullable=True)
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)
    source_rumour_id: Mapped[str] = mapped_column(String, nullable=True)
    source_narrative_id: Mapped[str] = mapped_column(String, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

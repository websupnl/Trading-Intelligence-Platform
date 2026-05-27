from sqlalchemy import String, Text, Float, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class RiskEvent(Base, TimestampMixin):
    __tablename__ = "risk_events"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    event_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    symbol: Mapped[str] = mapped_column(String(20), nullable=True)
    side: Mapped[str] = mapped_column(String(10), nullable=True)
    quantity: Mapped[float] = mapped_column(Float, nullable=True)
    notional: Mapped[float] = mapped_column(Float, nullable=True)
    approved: Mapped[bool] = mapped_column(default=False)
    reasons: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    blocked_by_rule: Mapped[str] = mapped_column(String(255), nullable=True)
    details: Mapped[dict] = mapped_column(JSON, nullable=True)

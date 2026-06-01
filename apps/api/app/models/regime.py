import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Float, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models.base import TimestampMixin


class RegimeState(TimestampMixin, Base):
    __tablename__ = "regime_states"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    regime: Mapped[str] = mapped_column(String(40), nullable=False, index=True)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    vix: Mapped[float | None] = mapped_column(Float, nullable=True)
    spy_vs_ema50: Mapped[float | None] = mapped_column(Float, nullable=True)
    spy_vs_ema200: Mapped[float | None] = mapped_column(Float, nullable=True)
    btc_dominance: Mapped[float | None] = mapped_column(Float, nullable=True)
    dollar_trend: Mapped[str | None] = mapped_column(String(20), nullable=True)
    metrics: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        index=True,
    )

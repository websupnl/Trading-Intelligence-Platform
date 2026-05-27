from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Rumour(Base, TimestampMixin):
    __tablename__ = "rumours"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    related_assets: Mapped[list] = mapped_column(JSON, default=list)
    source_news_ids: Mapped[list] = mapped_column(JSON, default=list)
    source_post_ids: Mapped[list] = mapped_column(JSON, default=list)
    independent_source_count: Mapped[int] = mapped_column(Integer, default=0)
    confidence: Mapped[float] = mapped_column(Float, default=0.0)
    manipulation_risk: Mapped[float] = mapped_column(Float, default=0.0)
    hype_velocity: Mapped[float] = mapped_column(Float, default=0.0)
    official_confirmation: Mapped[bool] = mapped_column(default=False)
    recommendation: Mapped[str] = mapped_column(String(50), default="watch")
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

from sqlalchemy import String, Text, Float, JSON, Integer
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Narrative(Base, TimestampMixin):
    __tablename__ = "narratives"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    narrative_type: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    strength: Mapped[float] = mapped_column(Float, default=0.0)
    momentum: Mapped[float] = mapped_column(Float, default=0.0)
    affected_assets: Mapped[list] = mapped_column(JSON, default=list)
    supporting_news_ids: Mapped[list] = mapped_column(JSON, default=list)
    evidence_count: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20), default="active")

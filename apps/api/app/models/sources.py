from sqlalchemy import String, Float, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class SourceCredibility(Base, TimestampMixin):
    __tablename__ = "source_credibility"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    source_name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    source_type: Mapped[str] = mapped_column(String(50), nullable=False)
    credibility_score: Mapped[float] = mapped_column(Float, default=0.5)
    accuracy_score: Mapped[float] = mapped_column(Float, default=0.5)
    total_signals: Mapped[int] = mapped_column(Integer, default=0)
    correct_signals: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")

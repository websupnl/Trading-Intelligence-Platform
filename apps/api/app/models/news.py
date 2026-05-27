from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class NewsItem(Base, TimestampMixin):
    __tablename__ = "news_items"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(1000), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=True)
    summary: Mapped[str] = mapped_column(Text, nullable=True)
    url: Mapped[str] = mapped_column(String(2000), nullable=True, unique=True)
    source: Mapped[str] = mapped_column(String(255), nullable=False)
    source_type: Mapped[str] = mapped_column(String(50), default="rss")
    published_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    tickers: Mapped[list] = mapped_column(JSON, default=list)
    sentiment: Mapped[str] = mapped_column(String(20), nullable=True)
    sentiment_score: Mapped[float] = mapped_column(Float, nullable=True)
    impact_score: Mapped[float] = mapped_column(Float, nullable=True)
    ai_analyzed: Mapped[bool] = mapped_column(default=False)
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="new")

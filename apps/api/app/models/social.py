from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON, BigInteger
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class SocialPost(Base, TimestampMixin):
    __tablename__ = "social_posts"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    external_id: Mapped[str] = mapped_column(String(255), nullable=True, index=True)
    platform: Mapped[str] = mapped_column(String(20), nullable=False)
    author: Mapped[str] = mapped_column(String(255), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    url: Mapped[str] = mapped_column(String(2000), nullable=True)
    subreddit: Mapped[str] = mapped_column(String(100), nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    tickers: Mapped[list] = mapped_column(JSON, default=list)
    score: Mapped[int] = mapped_column(BigInteger, nullable=True)
    num_comments: Mapped[int] = mapped_column(BigInteger, nullable=True)
    sentiment: Mapped[str] = mapped_column(String(20), nullable=True)
    sentiment_score: Mapped[float] = mapped_column(Float, nullable=True)
    hype_score: Mapped[float] = mapped_column(Float, nullable=True)
    ai_analyzed: Mapped[bool] = mapped_column(default=False)
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)

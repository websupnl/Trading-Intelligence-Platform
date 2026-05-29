from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, JSON, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class PolymarketPosition(Base, TimestampMixin):
    __tablename__ = "polymarket_positions"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    condition_id: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    yes_token_id: Mapped[str] = mapped_column(String(200), nullable=True)
    no_token_id: Mapped[str] = mapped_column(String(200), nullable=True)
    market_question: Mapped[str] = mapped_column(Text, nullable=False)
    market_slug: Mapped[str] = mapped_column(String(300), nullable=True)
    market_end_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    side: Mapped[str] = mapped_column(String(10), nullable=False)  # "yes" or "no"
    shares: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    avg_price: Mapped[float] = mapped_column(Float, nullable=False)  # 0.0-1.0
    invested_usd: Mapped[float] = mapped_column(Float, nullable=False)
    current_price: Mapped[float] = mapped_column(Float, nullable=True)
    ai_probability: Mapped[float] = mapped_column(Float, nullable=True)
    market_probability: Mapped[float] = mapped_column(Float, nullable=True)
    edge: Mapped[float] = mapped_column(Float, nullable=True)  # ai_prob - market_prob
    mode: Mapped[str] = mapped_column(String(10), default="paper")
    status: Mapped[str] = mapped_column(String(30), default="open", index=True)
    pnl: Mapped[float] = mapped_column(Float, nullable=True)
    pnl_pct: Mapped[float] = mapped_column(Float, nullable=True)
    ai_reasoning: Mapped[str] = mapped_column(Text, nullable=True)
    ai_analysis: Mapped[dict] = mapped_column(JSON, nullable=True)
    broker_order_id: Mapped[str] = mapped_column(String(200), nullable=True)
    resolved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=True)

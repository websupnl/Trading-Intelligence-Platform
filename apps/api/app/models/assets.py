from sqlalchemy import String, Boolean, Float, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base
from app.models.base import TimestampMixin
import uuid


class Asset(Base, TimestampMixin):
    __tablename__ = "assets"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    symbol: Mapped[str] = mapped_column(String(20), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    asset_class: Mapped[str] = mapped_column(String(50), default="us_equity")
    exchange: Mapped[str] = mapped_column(String(50), nullable=True)
    tradable: Mapped[bool] = mapped_column(Boolean, default=True)
    shortable: Mapped[bool] = mapped_column(Boolean, default=False)
    marginable: Mapped[bool] = mapped_column(Boolean, default=False)
    fractionable: Mapped[bool] = mapped_column(Boolean, default=False)
    min_order_size: Mapped[float] = mapped_column(Float, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")
    notes: Mapped[str] = mapped_column(Text, nullable=True)

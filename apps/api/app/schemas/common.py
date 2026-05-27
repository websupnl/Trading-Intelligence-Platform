from pydantic import BaseModel
from typing import Any, Optional


class StatusResponse(BaseModel):
    status: str
    message: Optional[str] = None


class IntegrationStatus(BaseModel):
    configured: bool
    status: str
    message: str


class ConfigStatus(BaseModel):
    alpaca: IntegrationStatus
    anthropic: IntegrationStatus
    openai: IntegrationStatus
    ollama: IntegrationStatus
    reddit: IntegrationStatus
    x_twitter: IntegrationStatus
    telegram: IntegrationStatus
    news_feeds: IntegrationStatus
    crypto_feeds: IntegrationStatus
    trading_mode: str
    live_trading_enabled: bool
    kill_switch_enabled: bool
    require_manual_confirmation: bool
    use_mock_data: bool


class PaginatedResponse(BaseModel):
    items: list[Any]
    total: int
    page: int
    page_size: int

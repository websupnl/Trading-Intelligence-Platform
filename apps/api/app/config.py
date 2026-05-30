from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_env: str = "local"
    use_mock_data: bool = False
    log_level: str = "INFO"
    secret_key: str = "change_me"

    # Database
    database_url: str = "postgresql+psycopg://trading_os:change_me@postgres:5432/trading_os"
    postgres_db: str = "trading_os"
    postgres_user: str = "trading_os"
    postgres_password: str = "change_me"

    # Redis
    redis_url: str = "redis://redis:6379/0"

    # Qdrant
    qdrant_url: str = "http://qdrant:6333"

    # Trading safety
    trading_mode: str = "paper"
    live_trading_enabled: bool = False
    require_manual_confirmation: bool = False
    kill_switch_enabled: bool = False
    allow_short_selling: bool = False  # Short selling disabled by default — only longs
    position_size_pct: float = 0.10   # 10% of account equity per trade
    max_daily_loss_pct: float = 0.08  # 8% daily loss triggers circuit breaker
    crypto_24_7_enabled: bool = True  # 24/7 crypto trading — persists across restarts

    # Alpaca
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_data_url: str = "https://data.alpaca.markets"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"
    anthropic_analysis_model: str = "claude-haiku-4-5-20251001"  # cheaper model for news/social
    anthropic_enable_prompt_caching: bool = True
    anthropic_max_tokens: int = 4096
    anthropic_enable_web_search: bool = False
    anthropic_enable_web_fetch: bool = False
    anthropic_enable_batches: bool = False

    # OpenAI
    openai_api_key: str = ""
    openai_model: str = "gpt-4o"

    # Ollama
    ollama_base_url: str = "http://host.docker.internal:11434"
    ollama_model: str = "llama3.2"

    # AI
    default_ai_provider: str = "anthropic"
    local_ai_provider: str = "ollama"

    # Reddit
    reddit_client_id: str = ""
    reddit_client_secret: str = ""
    reddit_user_agent: str = "trading-os-local/1.0"

    # X / Twitter
    x_bearer_token: str = ""

    # Alerts
    telegram_bot_token: str = ""
    telegram_chat_id: str = ""

    # Feeds
    news_feeds: str = ""
    crypto_news_feeds: str = ""

    # Frontend
    next_public_api_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.cors_origins.split(",") if o.strip()]

    @property
    def alpaca_configured(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_secret_key)

    @property
    def anthropic_configured(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def openai_configured(self) -> bool:
        return bool(self.openai_api_key)

    @property
    def reddit_configured(self) -> bool:
        return bool(self.reddit_client_id and self.reddit_client_secret)

    @property
    def x_configured(self) -> bool:
        return bool(self.x_bearer_token)

    @property
    def telegram_configured(self) -> bool:
        return bool(self.telegram_bot_token and self.telegram_chat_id)

    @property
    def news_feed_list(self) -> list[str]:
        if not self.news_feeds:
            return []
        return [f.strip() for f in self.news_feeds.split(",") if f.strip()]

    @property
    def crypto_feed_list(self) -> list[str]:
        if not self.crypto_news_feeds:
            return []
        return [f.strip() for f in self.crypto_news_feeds.split(",") if f.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()

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
    require_manual_confirmation: bool = True
    kill_switch_enabled: bool = False

    # Alpaca
    alpaca_api_key: str = ""
    alpaca_secret_key: str = ""
    alpaca_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_data_url: str = "https://data.alpaca.markets"

    # Anthropic
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"
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

    # Feeds
    news_feeds: str = ""
    crypto_news_feeds: str = ""

    # Frontend
    next_public_api_url: str = "http://localhost:8000"

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

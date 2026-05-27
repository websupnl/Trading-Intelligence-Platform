from app.config import get_settings
from app.schemas.common import ConfigStatus, IntegrationStatus


def get_config_status() -> ConfigStatus:
    s = get_settings()

    def status(configured: bool, name: str) -> IntegrationStatus:
        if configured:
            return IntegrationStatus(configured=True, status="configured", message=f"{name} geconfigureerd")
        return IntegrationStatus(configured=False, status="not_configured", message=f"{name}: API key ontbreekt")

    news_ok = len(s.news_feed_list) > 0
    crypto_ok = len(s.crypto_feed_list) > 0

    return ConfigStatus(
        alpaca=status(s.alpaca_configured, "Alpaca"),
        anthropic=status(s.anthropic_configured, "Anthropic Claude"),
        openai=status(s.openai_configured, "OpenAI"),
        ollama=IntegrationStatus(configured=True, status="optional", message="Ollama: verbinding wordt getest bij gebruik"),
        reddit=status(s.reddit_configured, "Reddit"),
        x_twitter=status(s.x_configured, "X/Twitter"),
        news_feeds=IntegrationStatus(
            configured=news_ok,
            status="configured" if news_ok else "not_configured",
            message=f"{len(s.news_feed_list)} nieuwsfeeds geconfigureerd" if news_ok else "Geen nieuwsfeeds ingesteld"
        ),
        crypto_feeds=IntegrationStatus(
            configured=crypto_ok,
            status="configured" if crypto_ok else "not_configured",
            message=f"{len(s.crypto_feed_list)} crypto feeds geconfigureerd" if crypto_ok else "Geen crypto feeds ingesteld"
        ),
        trading_mode=s.trading_mode,
        live_trading_enabled=s.live_trading_enabled,
        kill_switch_enabled=s.kill_switch_enabled,
        require_manual_confirmation=s.require_manual_confirmation,
        use_mock_data=s.use_mock_data,
    )

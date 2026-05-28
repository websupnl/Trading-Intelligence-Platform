from datetime import datetime, timezone


def us_market_open(now: datetime | None = None) -> bool:
    """Approximate regular US stock market hours: Mon-Fri, 14:30-21:00 UTC."""
    current = now or datetime.now(timezone.utc)
    if current.weekday() >= 5:
        return False
    minutes = current.hour * 60 + current.minute
    return 870 <= minutes <= 1260


def market_session_status() -> dict:
    open_now = us_market_open()
    return {
        "us_market_open": open_now,
        "crypto_only": not open_now,
        "message": (
            "US aandelenmarkt open - aandelen en crypto worden verwerkt"
            if open_now
            else "US aandelenmarkt gesloten - pipeline focust op crypto"
        ),
    }

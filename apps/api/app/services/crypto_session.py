from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from app.services.market_session import market_session_status
from app.services.runtime_state import get_runtime_value, set_runtime_value

SESSION_KEY = "autonomous_crypto_session"
DEFAULT_SESSION = {
    "active": False,
    "session_id": None,
    "started_at": None,
    "expires_at": None,
    "duration_minutes": 0,
    "max_notional_per_trade": 0.0,
    "max_trades": 0,
    "note": None,
}


def get_crypto_session() -> dict[str, Any]:
    session = get_runtime_value(SESSION_KEY, DEFAULT_SESSION.copy())
    if not isinstance(session, dict):
        session = DEFAULT_SESSION.copy()

    active = bool(session.get("active"))
    expires_at = session.get("expires_at")
    if active and expires_at:
        try:
            expires = datetime.fromisoformat(str(expires_at))
            if expires <= datetime.now(timezone.utc):
                session = stop_crypto_session("expired")
        except ValueError:
            session = stop_crypto_session("invalid_expiry")

    market = market_session_status()
    return {
        **DEFAULT_SESSION,
        **session,
        "market_session": market,
        "autonomous_allowed_now": bool(session.get("active")),
    }


def start_crypto_session(
    duration_minutes: int = 120,
    max_notional_per_trade: float = 250.0,
    max_trades: int = 5,
    note: str | None = None,
) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    duration = max(15, min(int(duration_minutes), 480))
    notional = max(25.0, min(float(max_notional_per_trade), 2500.0))
    trades = max(1, min(int(max_trades), 25))
    session = {
        "active": True,
        "session_id": uuid4().hex,
        "started_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=duration)).isoformat(),
        "duration_minutes": duration,
        "max_notional_per_trade": notional,
        "max_trades": trades,
        "note": note,
        "stop_reason": None,
    }
    set_runtime_value(SESSION_KEY, session)
    return get_crypto_session()


def stop_crypto_session(reason: str = "manual") -> dict[str, Any]:
    current = get_runtime_value(SESSION_KEY, DEFAULT_SESSION.copy())
    session = {
        **DEFAULT_SESSION,
        "active": False,
        "session_id": current.get("session_id") if isinstance(current, dict) else None,
        "started_at": current.get("started_at") if isinstance(current, dict) else None,
        "expires_at": None,
        "stop_reason": reason,
    }
    set_runtime_value(SESSION_KEY, session)
    return session


def crypto_session_allows_autonomy() -> bool:
    session = get_crypto_session()
    return bool(session["autonomous_allowed_now"])

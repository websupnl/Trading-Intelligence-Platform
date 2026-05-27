import json
import logging
from typing import Any

import redis

from app.config import get_settings

logger = logging.getLogger(__name__)
PREFIX = "trading_os:runtime:"


def get_runtime_value(key: str, default: Any) -> Any:
    """Read process-shared runtime controls from Redis, falling back to config."""
    try:
        client = redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=0.2, socket_timeout=0.2)
        value = client.get(f"{PREFIX}{key}")
        return json.loads(value) if value is not None else default
    except Exception:
        return default


def set_runtime_value(key: str, value: Any) -> bool:
    """Store runtime controls where both API and Celery workers can observe them."""
    try:
        client = redis.Redis.from_url(get_settings().redis_url, socket_connect_timeout=0.5, socket_timeout=0.5)
        client.set(f"{PREFIX}{key}", json.dumps(value))
        return True
    except Exception as exc:
        logger.warning("Runtime setting %s kon niet in Redis worden opgeslagen: %s", key, exc)
        return False

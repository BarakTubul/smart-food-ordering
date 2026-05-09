from __future__ import annotations

import json
from typing import Any

from redis import Redis

from app.core.settings import get_settings

_redis_client: Redis | None = None


def get_redis() -> Redis:
    global _redis_client
    if _redis_client is not None:
        return _redis_client

    settings = get_settings()
    if not getattr(settings, "redis_enabled", False):
        raise RuntimeError("Redis is not enabled in settings")

    _redis_client = Redis.from_url(settings.redis_url, decode_responses=True)
    return _redis_client


def close_redis() -> None:
    global _redis_client
    if _redis_client is None:
        return
    try:
        _redis_client.close()
    except Exception:
        pass
    _redis_client = None

from __future__ import annotations

import json
from typing import Any, Callable

from app.services.cache.client import get_redis
from app.core.settings import get_settings


def _serialize(value: Any) -> str:
    return json.dumps(value, default=str)


def _deserialize(value: str) -> Any:
    return json.loads(value)


def get_cached(key: str, loader: Callable[[], Any], ttl_seconds: int = 60) -> Any:
    settings = get_settings()
    if not getattr(settings, "redis_enabled", False):
        return loader()

    try:
        r = get_redis()
    except RuntimeError:
        return loader()

    try:
        existing = r.get(key)
        if existing is not None:
            return _deserialize(existing)

        value = loader()
        # store serialized
        r.set(key, _serialize(value), ex=ttl_seconds)
        return value
    except Exception:
        return loader()


def invalidate_key(key: str) -> None:
    try:
        r = get_redis()
    except RuntimeError:
        return
    try:
        r.delete(key)
    except Exception:
        pass

from __future__ import annotations

import os
from enum import Enum
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    DEV = "dev"
    STAGING = "staging"
    PROD = "prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Smart Food Ordering Platform — Ordering & FAQ Assistant"
    app_env: Environment = Environment.DEV
    api_prefix: str = "/api/v1"

    database_url: str = "postgresql+psycopg://app:app@localhost:5432/ordering_platform"

    jwt_secret_key: str = "change-me"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60

    auth_cookie_name: str = "access_token"
    cors_origins_raw: str = "http://localhost:3000"
    admin_emails_raw: str = "admin@example.com"

    llm_provider: str = "mock"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    llm_temperature: float = 0.0
    intent_rule_confidence_threshold: float = 0.75
    intent_escalation_confidence_threshold: float = 0.6
    llm_faq_synthesis_enabled: bool = True
    faq_chunks_path: str = "data/faq_chunks.json"
    faq_retrieval_top_k: int = 5
    faq_max_context_chunks: int = 5
    faq_max_context_chars: int = 2200
    faq_min_chunk_score: float = 0.0
    faq_relative_score_floor: float = 0.0
    faq_synthesis_history_messages: int = 6
    faq_synthesis_history_chars: int = 1200
    refund_window_hours: int = 48
    mock_data_path: str = "backend/data/mock_data.json"
    # Redis caching configuration
    redis_enabled: bool = False
    redis_url: str = "redis://localhost:6379/0"
    redis_default_ttl_seconds: int = 60

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins_raw.split(",") if origin.strip()]

    @property
    def admin_emails(self) -> set[str]:
        return {
            email.strip().lower()
            for email in self.admin_emails_raw.split(",")
            if email.strip()
        }

    @property
    def is_dev(self) -> bool:
        return self.app_env == Environment.DEV

    @property
    def is_staging(self) -> bool:
        return self.app_env == Environment.STAGING

    @property
    def is_prod(self) -> bool:
        return self.app_env == Environment.PROD

    @property
    def debug(self) -> bool:
        return self.is_dev

    @property
    def log_level(self) -> str:
        if self.is_prod:
            return "INFO"
        if self.is_staging:
            return "DEBUG"
        return "DEBUG"

    @property
    def auth_cookie_secure(self) -> bool:
        return self.is_staging or self.is_prod

    @property
    def auth_cookie_samesite(self) -> str:
        if self.is_prod:
            return "strict"
        return "lax"

    @property
    def expose_error_details(self) -> bool:
        return self.is_dev


def _select_env_files() -> tuple[str, str]:
    raw_env = os.getenv("APP_ENV", Environment.DEV.value).strip().lower()
    if raw_env not in {Environment.DEV.value, Environment.STAGING.value, Environment.PROD.value}:
        raw_env = Environment.DEV.value
    return ".env", f".env.{raw_env}"


@lru_cache
def get_settings() -> Settings:
    env_files = _select_env_files()
    return Settings(_env_file=env_files)

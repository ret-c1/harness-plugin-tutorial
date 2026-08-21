from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _as_bool(value: str | None, default: bool) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    app_name: str
    app_env: str
    database_path: Path
    jwt_secret: str
    token_expire_minutes: int
    seed_default_users: bool
    cors_origins: list[str]


def get_settings() -> Settings:
    origins = os.getenv("CORS_ORIGINS", "*")
    return Settings(
        app_name=os.getenv("APP_NAME", "DeepSeek Harness Security API"),
        app_env=os.getenv("APP_ENV", "development"),
        database_path=Path(os.getenv("DATABASE_PATH", "./data/security.db")).expanduser(),
        jwt_secret=os.getenv("JWT_SECRET", "dev-only-change-me-before-production"),
        token_expire_minutes=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "480")),
        seed_default_users=_as_bool(os.getenv("SEED_DEFAULT_USERS"), True),
        cors_origins=[item.strip() for item in origins.split(",") if item.strip()],
    )


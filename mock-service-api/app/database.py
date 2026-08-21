from __future__ import annotations

import sqlite3
from collections.abc import Generator
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_settings
from app.modules.memory.schema import SCHEMA as MEMORY_SCHEMA
from app.modules.security.schema import SCHEMA as SECURITY_SCHEMA
from app.security import hash_password


SCHEMA = "\n".join((SECURITY_SCHEMA, MEMORY_SCHEMA))


def utc_now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or get_settings().database_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=15, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def init_db(path: Path | None = None, seed_users: bool | None = None) -> None:
    settings = get_settings()
    connection = connect(path)
    try:
        connection.executescript(SCHEMA)
        should_seed = settings.seed_default_users if seed_users is None else seed_users
        if should_seed:
            _seed_default_users(connection)
        connection.commit()
    finally:
        connection.close()


def _seed_default_users(connection: sqlite3.Connection) -> None:
    now = utc_now()
    defaults = (
        ("admin", "Admin@123", "系统管理员", "管理员", "admin@example.local", "admin"),
        ("user_a", "UserA@123", "用户 A", "运营人员", "user_a@example.local", "user_a"),
        ("user_b", "UserB@123", "用户 B", "审计人员", "user_b@example.local", "user_b"),
    )
    for username, password, name, nickname, email, role in defaults:
        if connection.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone():
            continue
        connection.execute(
            """
            INSERT INTO users (
                username, password_hash, name, nickname, email, role,
                is_active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (username, hash_password(password), name, nickname, email, role, now, now),
        )


def get_db() -> Generator[sqlite3.Connection, None, None]:
    connection = connect()
    try:
        yield connection
    finally:
        connection.close()

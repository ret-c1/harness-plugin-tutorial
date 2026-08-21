from __future__ import annotations

import sqlite3
from collections.abc import Callable
from typing import Annotated, Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import get_settings
from app.database import get_db
from app.security import decode_access_token


bearer_scheme = HTTPBearer(auto_error=False)
Db = Annotated[sqlite3.Connection, Depends(get_db)]

PERMISSIONS: dict[str, set[str]] = {
    "admin": {"read", "create", "update", "delete"},
    "user_a": {"read", "create", "update"},
    "user_b": {"read"},
}


def get_current_user(
    db: Db,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> dict[str, Any]:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未登录、Token 无效或已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise unauthorized
    try:
        payload = decode_access_token(credentials.credentials, get_settings().jwt_secret)
        user_id = int(payload["sub"])
    except (ValueError, TypeError, KeyError):
        raise unauthorized from None

    row = db.execute(
        "SELECT * FROM users WHERE id = ? AND is_active = 1", (user_id,)
    ).fetchone()
    if row is None:
        raise unauthorized
    return dict(row)


CurrentUser = Annotated[dict[str, Any], Depends(get_current_user)]


def require_action(action: str) -> Callable[..., dict[str, Any]]:
    def dependency(current_user: CurrentUser) -> dict[str, Any]:
        if action not in PERMISSIONS.get(current_user["role"], set()):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"角色 {current_user['role']} 无 {action} 权限",
            )
        return current_user

    return dependency


def require_admin(current_user: CurrentUser) -> dict[str, Any]:
    if current_user["role"] != "admin":
        raise HTTPException(status_code=403, detail="该操作仅管理员可执行")
    return current_user


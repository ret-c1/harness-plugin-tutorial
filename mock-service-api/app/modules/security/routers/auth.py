"""认证接口。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.database import utc_now
from app.dependencies import CurrentUser, Db
from app.modules.security.models import (
    LoginRequest,
    PasswordChange,
    TokenResponse,
    UserRead,
)
from app.modules.security.repository import commit_or_conflict, user_from_row
from app.schemas import MessageResponse
from app.security import create_access_token, hash_password, verify_password


router = APIRouter(prefix="/auth", tags=["认证"])


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="用户登录",
    description="用户名密码登录，成功后返回 Bearer Token。",
)
def login(payload: LoginRequest, db: Db) -> TokenResponse:
    row = db.execute("SELECT * FROM users WHERE username = ?", (payload.username,)).fetchone()
    if row is None or not row["is_active"] or not verify_password(
        payload.password, row["password_hash"]
    ):
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    now = utc_now()
    db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now, row["id"]))
    commit_or_conflict(db)
    settings = get_settings()
    token, expires_at = create_access_token(
        str(row["id"]), row["role"], settings.jwt_secret, settings.token_expire_minutes
    )
    return TokenResponse(access_token=token, expires_at=expires_at)


@router.get("/me", response_model=UserRead, summary="查询当前用户")
def me(current_user: CurrentUser) -> dict:
    return user_from_row(current_user)


@router.put(
    "/password",
    response_model=MessageResponse,
    summary="修改自己的密码",
)
def change_password(
    payload: PasswordChange,
    current_user: CurrentUser,
    db: Db,
) -> MessageResponse:
    if not verify_password(payload.current_password, current_user["password_hash"]):
        raise HTTPException(status_code=400, detail="当前密码错误")
    if payload.current_password == payload.new_password:
        raise HTTPException(status_code=400, detail="新密码不能与当前密码相同")
    now = utc_now()
    db.execute(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (hash_password(payload.new_password), now, current_user["id"]),
    )
    commit_or_conflict(db)
    return MessageResponse(message="密码修改成功")

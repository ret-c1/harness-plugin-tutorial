"""用户管理接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import Db, require_action, require_admin
from app.modules.security.models import (
    PasswordReset,
    Role,
    UserCreate,
    UserRead,
    UserUpdate,
)
from app.modules.security.repository import (
    commit_or_conflict,
    ensure_row,
    insert_record,
    update_record,
    user_from_row,
)
from app.schemas import Page
from app.security import hash_password


router = APIRouter(prefix="/users", tags=["用户管理"])


@router.get("", response_model=Page[UserRead], summary="分页查询用户")
def list_users(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=100, description="匹配用户名、姓名、昵称、邮箱"),
    role: Role | None = None,
    is_active: bool | None = None,
) -> dict:
    conditions: list[str] = []
    params: list[object] = []
    if search:
        conditions.append("(username LIKE ? OR name LIKE ? OR nickname LIKE ? OR email LIKE ?)")
        pattern = f"%{search}%"
        params.extend([pattern] * 4)
    if role is not None:
        conditions.append("role = ?")
        params.append(role.value)
    if is_active is not None:
        conditions.append("is_active = ?")
        params.append(int(is_active))
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.execute(f"SELECT COUNT(*) AS count FROM users{where}", params).fetchone()["count"]
    rows = db.execute(
        f"SELECT * FROM users{where} ORDER BY id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [user_from_row(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{user_id}", response_model=UserRead, summary="查询用户详情")
def get_user(
    user_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    return user_from_row(ensure_row(db, "users", user_id, "用户"))


@router.post("", response_model=UserRead, status_code=201, summary="创建用户")
def create_user(
    payload: UserCreate,
    db: Db,
    actor: Annotated[dict, Depends(require_action("create"))],
) -> dict:
    if actor["role"] != "admin" and payload.role != Role.USER_B:
        raise HTTPException(status_code=403, detail="user_a 只能创建 user_b 用户")
    now = utc_now()
    data = payload.model_dump(mode="json")
    password = data.pop("password")
    data.update(
        password_hash=hash_password(password),
        is_active=int(data["is_active"]),
        created_at=now,
        updated_at=now,
    )
    user_id = insert_record(db, "users", data)
    commit_or_conflict(db, "用户名或邮箱已存在")
    return user_from_row(ensure_row(db, "users", user_id, "用户"))


@router.patch("/{user_id}", response_model=UserRead, summary="修改用户")
def update_user(
    user_id: int,
    payload: UserUpdate,
    db: Db,
    actor: Annotated[dict, Depends(require_action("update"))],
) -> dict:
    ensure_row(db, "users", user_id, "用户")
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="至少提供一个要修改的字段")
    privileged = {"role", "is_active"} & set(data)
    if privileged and actor["role"] != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可修改角色或启用状态")
    if actor["id"] == user_id and (
        data.get("is_active") is False or data.get("role", "admin") != "admin"
    ):
        raise HTTPException(status_code=400, detail="管理员不能停用或降级自己的账号")
    if "is_active" in data:
        data["is_active"] = int(data["is_active"])
    data["updated_at"] = utc_now()
    update_record(db, "users", user_id, data)
    commit_or_conflict(db, "邮箱已被其他用户使用")
    return user_from_row(ensure_row(db, "users", user_id, "用户"))


@router.put("/{user_id}/password", status_code=204, summary="管理员重置用户密码")
def reset_password(
    user_id: int,
    payload: PasswordReset,
    db: Db,
    _: Annotated[dict, Depends(require_admin)],
) -> Response:
    ensure_row(db, "users", user_id, "用户")
    db.execute(
        "UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?",
        (hash_password(payload.new_password), utc_now(), user_id),
    )
    commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("/{user_id}", status_code=204, summary="删除用户")
def delete_user(
    user_id: int,
    db: Db,
    actor: Annotated[dict, Depends(require_action("delete"))],
) -> Response:
    ensure_row(db, "users", user_id, "用户")
    if actor["id"] == user_id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")
    db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

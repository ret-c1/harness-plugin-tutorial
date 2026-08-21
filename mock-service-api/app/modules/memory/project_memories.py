from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import CurrentUser, Db
from app.modules.memory.models import (
    ProjectMemoryCreate,
    ProjectMemoryRead,
    ProjectMemoryUpdate,
)
from app.modules.memory.repository import (
    delete_owned_record,
    ensure_owned_row,
    insert_record,
    json_metadata,
    record_from_row,
    update_record,
)
from app.schemas import Page


router = APIRouter(prefix="/project-memories", tags=["Project Memory"])


@router.get("", response_model=Page[ProjectMemoryRead], summary="查询当前用户的 Project Memory")
def list_project_memories(
    current_user: CurrentUser,
    db: Db,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    project_id: str | None = Query(None, max_length=256),
    search: str | None = Query(None, max_length=200, description="匹配 key 或 content"),
) -> dict:
    conditions = ["user_id = ?"]
    params: list[object] = [current_user["id"]]
    if project_id:
        conditions.append("project_id = ?")
        params.append(project_id)
    if search:
        conditions.append("(memory_key LIKE ? OR content LIKE ?)")
        params.extend([f"%{search}%"] * 2)
    where = " AND ".join(conditions)
    total = db.execute(
        f"SELECT COUNT(*) AS count FROM project_memories WHERE {where}", params
    ).fetchone()["count"]
    rows = db.execute(
        f"SELECT * FROM project_memories WHERE {where} "
        "ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [record_from_row(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post(
    "",
    response_model=ProjectMemoryRead,
    status_code=201,
    summary="创建 Project Memory",
)
def create_project_memory(
    payload: ProjectMemoryCreate,
    current_user: CurrentUser,
    db: Db,
) -> dict:
    data = payload.model_dump(mode="json")
    data["memory_key"] = data.pop("key")
    data["metadata"] = json_metadata(data["metadata"])
    now = utc_now()
    data.update(user_id=current_user["id"], created_at=now, updated_at=now)
    memory_id = insert_record(
        db,
        "project_memories",
        data,
        "当前用户在该项目中已存在相同 key 的 Project Memory",
    )
    return record_from_row(
        ensure_owned_row(
            db, "project_memories", memory_id, current_user["id"], "Project Memory"
        )
    )


@router.get(
    "/{memory_id}", response_model=ProjectMemoryRead, summary="查询 Project Memory 详情"
)
def get_project_memory(memory_id: int, current_user: CurrentUser, db: Db) -> dict:
    return record_from_row(
        ensure_owned_row(
            db, "project_memories", memory_id, current_user["id"], "Project Memory"
        )
    )


@router.patch(
    "/{memory_id}", response_model=ProjectMemoryRead, summary="修改 Project Memory"
)
def update_project_memory(
    memory_id: int,
    payload: ProjectMemoryUpdate,
    current_user: CurrentUser,
    db: Db,
) -> dict:
    ensure_owned_row(
        db, "project_memories", memory_id, current_user["id"], "Project Memory"
    )
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="至少提供一个要修改的字段")
    if any(value is None for value in data.values()):
        raise HTTPException(status_code=422, detail="Project Memory 字段不能为 null")
    if "key" in data:
        data["memory_key"] = data.pop("key")
    if "metadata" in data:
        data["metadata"] = json_metadata(data["metadata"])
    data["updated_at"] = utc_now()
    update_record(
        db,
        "project_memories",
        memory_id,
        current_user["id"],
        data,
        "当前用户在该项目中已存在相同 key 的 Project Memory",
    )
    return record_from_row(
        ensure_owned_row(
            db, "project_memories", memory_id, current_user["id"], "Project Memory"
        )
    )


@router.delete("/{memory_id}", status_code=204, summary="删除 Project Memory")
def delete_project_memory(memory_id: int, current_user: CurrentUser, db: Db) -> Response:
    delete_owned_record(
        db, "project_memories", memory_id, current_user["id"], "Project Memory"
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import CurrentUser, Db
from app.modules.memory.models import (
    TaskHistoryCreate,
    TaskHistoryRead,
    TaskHistoryUpdate,
    TaskStatus,
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


router = APIRouter(prefix="/task-history", tags=["Task History"])
TERMINAL_STATUSES = {
    TaskStatus.COMPLETED.value,
    TaskStatus.FAILED.value,
    TaskStatus.CANCELLED.value,
}


@router.get("", response_model=Page[TaskHistoryRead], summary="查询当前用户的 Task History")
def list_task_history(
    current_user: CurrentUser,
    db: Db,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    project_id: str | None = Query(None, max_length=256),
    session_id: str | None = Query(None, max_length=128),
    task_status: TaskStatus | None = Query(None, alias="status"),
    search: str | None = Query(
        None, max_length=200, description="匹配 task_id、标题、输入或输出"
    ),
) -> dict:
    conditions = ["user_id = ?"]
    params: list[object] = [current_user["id"]]
    if project_id:
        conditions.append("project_id = ?")
        params.append(project_id)
    if session_id:
        conditions.append("session_id = ?")
        params.append(session_id)
    if task_status is not None:
        conditions.append("status = ?")
        params.append(task_status.value)
    if search:
        conditions.append(
            "(task_id LIKE ? OR title LIKE ? OR task_input LIKE ? OR task_output LIKE ?)"
        )
        params.extend([f"%{search}%"] * 4)
    where = " AND ".join(conditions)
    total = db.execute(
        f"SELECT COUNT(*) AS count FROM task_history WHERE {where}", params
    ).fetchone()["count"]
    rows = db.execute(
        f"SELECT * FROM task_history WHERE {where} "
        "ORDER BY started_at DESC, id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [record_from_row(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", response_model=TaskHistoryRead, status_code=201, summary="创建 Task History")
def create_task_history(
    payload: TaskHistoryCreate,
    current_user: CurrentUser,
    db: Db,
) -> dict:
    data = payload.model_dump(mode="json")
    if data["status"] in TERMINAL_STATUSES and not data["completed_at"]:
        data["completed_at"] = utc_now()
    elif data["status"] not in TERMINAL_STATUSES:
        data["completed_at"] = None
    data["metadata"] = json_metadata(data["metadata"])
    now = utc_now()
    data.update(user_id=current_user["id"], created_at=now, updated_at=now)
    history_id = insert_record(
        db,
        "task_history",
        data,
        "当前用户已存在相同 task_id 的 Task History",
    )
    return record_from_row(
        ensure_owned_row(db, "task_history", history_id, current_user["id"], "Task History")
    )


@router.get("/{history_id}", response_model=TaskHistoryRead, summary="查询 Task History 详情")
def get_task_history(history_id: int, current_user: CurrentUser, db: Db) -> dict:
    return record_from_row(
        ensure_owned_row(db, "task_history", history_id, current_user["id"], "Task History")
    )


@router.patch("/{history_id}", response_model=TaskHistoryRead, summary="修改 Task History")
def update_task_history(
    history_id: int,
    payload: TaskHistoryUpdate,
    current_user: CurrentUser,
    db: Db,
) -> dict:
    ensure_owned_row(db, "task_history", history_id, current_user["id"], "Task History")
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="至少提供一个要修改的字段")
    required_fields = {"task_id", "title", "task_input", "status", "started_at", "metadata"}
    if any(data.get(field) is None for field in required_fields & set(data)):
        raise HTTPException(status_code=422, detail="Task History 必填字段不能为 null")
    if data.get("status") in TERMINAL_STATUSES and "completed_at" not in data:
        data["completed_at"] = utc_now()
    elif "status" in data and data["status"] not in TERMINAL_STATUSES:
        data["completed_at"] = None
    if "metadata" in data:
        data["metadata"] = json_metadata(data["metadata"])
    data["updated_at"] = utc_now()
    update_record(
        db,
        "task_history",
        history_id,
        current_user["id"],
        data,
        "当前用户已存在相同 task_id 的 Task History",
    )
    return record_from_row(
        ensure_owned_row(db, "task_history", history_id, current_user["id"], "Task History")
    )


@router.delete("/{history_id}", status_code=204, summary="删除 Task History")
def delete_task_history(history_id: int, current_user: CurrentUser, db: Db) -> Response:
    delete_owned_record(db, "task_history", history_id, current_user["id"], "Task History")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

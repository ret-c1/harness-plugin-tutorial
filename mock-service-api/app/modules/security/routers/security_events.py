"""安全事件管理接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import Db, require_action
from app.modules.security.models import (
    SecurityEventCreate,
    SecurityEventRead,
    SecurityEventUpdate,
    Severity,
    WorkflowStatus,
)
from app.modules.security.repository import (
    commit_or_conflict,
    ensure_row,
    event_from_row,
    insert_record,
    replace_asset_links,
    update_record,
)
from app.schemas import Page


router = APIRouter(prefix="/security-events", tags=["安全事件管理"])


def _validate_assignee(db, assignee_id: int | None) -> None:
    if assignee_id is not None:
        row = db.execute(
            "SELECT id FROM users WHERE id = ? AND is_active = 1", (assignee_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=422, detail="处置人不存在或已停用")


@router.get("", response_model=Page[SecurityEventRead], summary="分页查询安全事件")
def list_security_events(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200, description="匹配编号、标题、源 IP、目标 IP"),
    severity: Severity | None = None,
    workflow_status: WorkflowStatus | None = Query(None, alias="status"),
    category: str | None = Query(None, max_length=100),
    asset_id: int | None = Query(None, gt=0),
    assignee_id: int | None = Query(None, gt=0),
) -> dict:
    conditions: list[str] = []
    params: list[object] = []
    if search:
        conditions.append(
            "(e.event_code LIKE ? OR e.title LIKE ? OR e.source_ip LIKE ? OR e.destination_ip LIKE ?)"
        )
        params.extend([f"%{search}%"] * 4)
    if severity is not None:
        conditions.append("e.severity = ?")
        params.append(severity.value)
    if workflow_status is not None:
        conditions.append("e.status = ?")
        params.append(workflow_status.value)
    if category is not None:
        conditions.append("e.category = ?")
        params.append(category)
    if assignee_id is not None:
        conditions.append("e.assignee_id = ?")
        params.append(assignee_id)
    if asset_id is not None:
        conditions.append(
            "EXISTS (SELECT 1 FROM event_assets ea WHERE ea.event_id = e.id AND ea.asset_id = ?)"
        )
        params.append(asset_id)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.execute(
        f"SELECT COUNT(*) AS count FROM security_events e{where}", params
    ).fetchone()["count"]
    rows = db.execute(
        f"SELECT e.* FROM security_events e{where} ORDER BY e.id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [event_from_row(db, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{event_id}", response_model=SecurityEventRead, summary="查询安全事件详情")
def get_security_event(
    event_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    return event_from_row(db, ensure_row(db, "security_events", event_id, "安全事件"))


@router.post("", response_model=SecurityEventRead, status_code=201, summary="创建安全事件")
def create_security_event(
    payload: SecurityEventCreate,
    db: Db,
    _: Annotated[dict, Depends(require_action("create"))],
) -> dict:
    data = payload.model_dump(mode="json")
    asset_ids = data.pop("asset_ids")
    _validate_assignee(db, data["assignee_id"])
    if data["status"] == "closed" and not data["closed_at"]:
        data["closed_at"] = utc_now()
    elif data["status"] != "closed":
        data["closed_at"] = None
    now = utc_now()
    data.update(created_at=now, updated_at=now)
    event_id = insert_record(db, "security_events", data)
    replace_asset_links(db, "event_assets", "event_id", event_id, asset_ids)
    commit_or_conflict(db, "事件编号已存在")
    return event_from_row(db, ensure_row(db, "security_events", event_id, "安全事件"))


@router.patch("/{event_id}", response_model=SecurityEventRead, summary="修改安全事件")
def update_security_event(
    event_id: int,
    payload: SecurityEventUpdate,
    db: Db,
    _: Annotated[dict, Depends(require_action("update"))],
) -> dict:
    ensure_row(db, "security_events", event_id, "安全事件")
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="至少提供一个要修改的字段")
    asset_ids = data.pop("asset_ids", None)
    if "assignee_id" in data:
        _validate_assignee(db, data["assignee_id"])
    if data.get("status") == "closed" and "closed_at" not in data:
        data["closed_at"] = utc_now()
    elif "status" in data and data["status"] != "closed":
        data["closed_at"] = None
    data["updated_at"] = utc_now()
    update_record(db, "security_events", event_id, data)
    if asset_ids is not None:
        replace_asset_links(db, "event_assets", "event_id", event_id, asset_ids)
    commit_or_conflict(db, "事件编号已存在")
    return event_from_row(db, ensure_row(db, "security_events", event_id, "安全事件"))


@router.delete("/{event_id}", status_code=204, summary="删除安全事件")
def delete_security_event(
    event_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("delete"))],
) -> Response:
    ensure_row(db, "security_events", event_id, "安全事件")
    db.execute("DELETE FROM security_events WHERE id = ?", (event_id,))
    commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

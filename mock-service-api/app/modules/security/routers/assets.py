"""资产管理接口。"""

from __future__ import annotations

import json
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import Db, require_action
from app.modules.security.models import (
    AssetCreate,
    AssetDetail,
    AssetRead,
    AssetStatus,
    AssetType,
    AssetUpdate,
    Criticality,
    SecurityEventRead,
    VulnerabilityRead,
)
from app.modules.security.repository import (
    asset_from_row,
    commit_or_conflict,
    ensure_row,
    event_from_row,
    insert_record,
    update_record,
    vulnerability_from_row,
)
from app.schemas import Page


router = APIRouter(prefix="/assets", tags=["资产管理"])


def _validate_owner(db, owner_id: int | None) -> None:
    if owner_id is not None:
        row = db.execute(
            "SELECT id FROM users WHERE id = ? AND is_active = 1", (owner_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=422, detail="责任人不存在或已停用")


@router.get("", response_model=Page[AssetRead], summary="分页查询资产")
def list_assets(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200, description="匹配编码、名称、IP、主机名"),
    asset_type: AssetType | None = None,
    criticality: Criticality | None = None,
    asset_status: AssetStatus | None = Query(None, alias="status"),
    owner_id: int | None = Query(None, gt=0),
) -> dict:
    conditions: list[str] = []
    params: list[object] = []
    if search:
        conditions.append("(asset_code LIKE ? OR name LIKE ? OR ip_address LIKE ? OR hostname LIKE ?)")
        params.extend([f"%{search}%"] * 4)
    for column, value in (
        ("asset_type", asset_type),
        ("criticality", criticality),
        ("status", asset_status),
    ):
        if value is not None:
            conditions.append(f"{column} = ?")
            params.append(value.value)
    if owner_id is not None:
        conditions.append("owner_id = ?")
        params.append(owner_id)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.execute(f"SELECT COUNT(*) AS count FROM assets{where}", params).fetchone()["count"]
    rows = db.execute(
        f"SELECT * FROM assets{where} ORDER BY id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [asset_from_row(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{asset_id}", response_model=AssetDetail, summary="查询资产及关联风险")
def get_asset(
    asset_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    asset = asset_from_row(ensure_row(db, "assets", asset_id, "资产"))
    vulnerability_rows = db.execute(
        """
        SELECT v.* FROM vulnerabilities v
        JOIN vulnerability_assets va ON va.vulnerability_id = v.id
        WHERE va.asset_id = ? ORDER BY v.id DESC
        """,
        (asset_id,),
    ).fetchall()
    event_rows = db.execute(
        """
        SELECT e.* FROM security_events e
        JOIN event_assets ea ON ea.event_id = e.id
        WHERE ea.asset_id = ? ORDER BY e.id DESC
        """,
        (asset_id,),
    ).fetchall()
    asset["vulnerabilities"] = [
        vulnerability_from_row(db, row) for row in vulnerability_rows
    ]
    asset["security_events"] = [event_from_row(db, row) for row in event_rows]
    return asset


@router.get(
    "/{asset_id}/vulnerabilities",
    response_model=list[VulnerabilityRead],
    summary="查询资产关联漏洞",
)
def get_asset_vulnerabilities(
    asset_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> list[dict]:
    ensure_row(db, "assets", asset_id, "资产")
    rows = db.execute(
        """
        SELECT v.* FROM vulnerabilities v
        JOIN vulnerability_assets va ON va.vulnerability_id = v.id
        WHERE va.asset_id = ? ORDER BY v.id DESC
        """,
        (asset_id,),
    ).fetchall()
    return [vulnerability_from_row(db, row) for row in rows]


@router.get(
    "/{asset_id}/security-events",
    response_model=list[SecurityEventRead],
    summary="查询资产关联安全事件",
)
def get_asset_events(
    asset_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> list[dict]:
    ensure_row(db, "assets", asset_id, "资产")
    rows = db.execute(
        """
        SELECT e.* FROM security_events e
        JOIN event_assets ea ON ea.event_id = e.id
        WHERE ea.asset_id = ? ORDER BY e.id DESC
        """,
        (asset_id,),
    ).fetchall()
    return [event_from_row(db, row) for row in rows]


@router.post("", response_model=AssetRead, status_code=201, summary="创建资产")
def create_asset(
    payload: AssetCreate,
    db: Db,
    _: Annotated[dict, Depends(require_action("create"))],
) -> dict:
    data = payload.model_dump(mode="json")
    _validate_owner(db, data["owner_id"])
    data["tags"] = json.dumps(data["tags"], ensure_ascii=False)
    now = utc_now()
    data.update(created_at=now, updated_at=now)
    asset_id = insert_record(db, "assets", data)
    commit_or_conflict(db, "资产编码已存在")
    return asset_from_row(ensure_row(db, "assets", asset_id, "资产"))


@router.patch("/{asset_id}", response_model=AssetRead, summary="修改资产")
def update_asset(
    asset_id: int,
    payload: AssetUpdate,
    db: Db,
    _: Annotated[dict, Depends(require_action("update"))],
) -> dict:
    ensure_row(db, "assets", asset_id, "资产")
    data = payload.model_dump(mode="json", exclude_unset=True)
    if not data:
        raise HTTPException(status_code=400, detail="至少提供一个要修改的字段")
    if "owner_id" in data:
        _validate_owner(db, data["owner_id"])
    if "tags" in data:
        if data["tags"] is None:
            raise HTTPException(status_code=422, detail="tags 不能为 null；清空请传 []")
        data["tags"] = json.dumps(data["tags"], ensure_ascii=False)
    data["updated_at"] = utc_now()
    update_record(db, "assets", asset_id, data)
    commit_or_conflict(db, "资产编码已存在")
    return asset_from_row(ensure_row(db, "assets", asset_id, "资产"))


@router.delete("/{asset_id}", status_code=204, summary="删除资产")
def delete_asset(
    asset_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("delete"))],
) -> Response:
    ensure_row(db, "assets", asset_id, "资产")
    db.execute("DELETE FROM assets WHERE id = ?", (asset_id,))
    commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

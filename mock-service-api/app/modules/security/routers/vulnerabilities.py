"""漏洞管理接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.database import utc_now
from app.dependencies import Db, require_action
from app.modules.security.models import (
    Severity,
    VulnerabilityCreate,
    VulnerabilityRead,
    VulnerabilityUpdate,
    WorkflowStatus,
)
from app.modules.security.repository import (
    commit_or_conflict,
    ensure_row,
    insert_record,
    replace_asset_links,
    update_record,
    vulnerability_from_row,
)
from app.schemas import Page


router = APIRouter(prefix="/vulnerabilities", tags=["漏洞管理"])


def _validate_assignee(db, assignee_id: int | None) -> None:
    if assignee_id is not None:
        row = db.execute(
            "SELECT id FROM users WHERE id = ? AND is_active = 1", (assignee_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=422, detail="处置人不存在或已停用")


@router.get("", response_model=Page[VulnerabilityRead], summary="分页查询漏洞")
def list_vulnerabilities(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str | None = Query(None, max_length=200, description="匹配编号、名称、CVE"),
    severity: Severity | None = None,
    workflow_status: WorkflowStatus | None = Query(None, alias="status"),
    asset_id: int | None = Query(None, gt=0),
    assignee_id: int | None = Query(None, gt=0),
) -> dict:
    conditions: list[str] = []
    params: list[object] = []
    if search:
        conditions.append("(v.vuln_code LIKE ? OR v.name LIKE ? OR v.cve_id LIKE ?)")
        params.extend([f"%{search}%"] * 3)
    if severity is not None:
        conditions.append("v.severity = ?")
        params.append(severity.value)
    if workflow_status is not None:
        conditions.append("v.status = ?")
        params.append(workflow_status.value)
    if assignee_id is not None:
        conditions.append("v.assignee_id = ?")
        params.append(assignee_id)
    if asset_id is not None:
        conditions.append(
            "EXISTS (SELECT 1 FROM vulnerability_assets va WHERE va.vulnerability_id = v.id AND va.asset_id = ?)"
        )
        params.append(asset_id)
    where = f" WHERE {' AND '.join(conditions)}" if conditions else ""
    total = db.execute(
        f"SELECT COUNT(*) AS count FROM vulnerabilities v{where}", params
    ).fetchone()["count"]
    rows = db.execute(
        f"SELECT v.* FROM vulnerabilities v{where} ORDER BY v.id DESC LIMIT ? OFFSET ?",
        (*params, page_size, (page - 1) * page_size),
    ).fetchall()
    return {
        "items": [vulnerability_from_row(db, row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{vulnerability_id}", response_model=VulnerabilityRead, summary="查询漏洞详情")
def get_vulnerability(
    vulnerability_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    return vulnerability_from_row(
        db, ensure_row(db, "vulnerabilities", vulnerability_id, "漏洞")
    )


@router.post("", response_model=VulnerabilityRead, status_code=201, summary="创建漏洞")
def create_vulnerability(
    payload: VulnerabilityCreate,
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
    vulnerability_id = insert_record(db, "vulnerabilities", data)
    replace_asset_links(
        db,
        "vulnerability_assets",
        "vulnerability_id",
        vulnerability_id,
        asset_ids,
    )
    commit_or_conflict(db, "漏洞编号已存在")
    return vulnerability_from_row(
        db, ensure_row(db, "vulnerabilities", vulnerability_id, "漏洞")
    )


@router.patch("/{vulnerability_id}", response_model=VulnerabilityRead, summary="修改漏洞")
def update_vulnerability(
    vulnerability_id: int,
    payload: VulnerabilityUpdate,
    db: Db,
    _: Annotated[dict, Depends(require_action("update"))],
) -> dict:
    ensure_row(db, "vulnerabilities", vulnerability_id, "漏洞")
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
    update_record(db, "vulnerabilities", vulnerability_id, data)
    if asset_ids is not None:
        replace_asset_links(
            db,
            "vulnerability_assets",
            "vulnerability_id",
            vulnerability_id,
            asset_ids,
        )
    commit_or_conflict(db, "漏洞编号已存在")
    return vulnerability_from_row(
        db, ensure_row(db, "vulnerabilities", vulnerability_id, "漏洞")
    )


@router.delete("/{vulnerability_id}", status_code=204, summary="删除漏洞")
def delete_vulnerability(
    vulnerability_id: int,
    db: Db,
    _: Annotated[dict, Depends(require_action("delete"))],
) -> Response:
    ensure_row(db, "vulnerabilities", vulnerability_id, "漏洞")
    db.execute("DELETE FROM vulnerabilities WHERE id = ?", (vulnerability_id,))
    commit_or_conflict(db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

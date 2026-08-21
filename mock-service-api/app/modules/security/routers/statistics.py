"""安全统计接口。"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.dependencies import Db, require_action
from app.modules.security.models import (
    AssetRiskStatistics,
    DistributionStatistics,
    OwnershipStatistics,
)
from app.modules.security.repository import SEVERITY_KEYS, STATUS_KEYS, normalized_counts


router = APIRouter(prefix="/statistics", tags=["统计场景"])


def _group_counts(db, table: str, column: str, keys: tuple[str, ...]) -> dict[str, int]:
    rows = db.execute(
        f"SELECT {column} AS key, COUNT(*) AS count FROM {table} GROUP BY {column}"
    ).fetchall()
    return normalized_counts(rows, keys)


@router.get(
    "/assets/ownership",
    response_model=OwnershipStatistics,
    summary="场景 1：资产责任人覆盖情况",
)
def asset_ownership(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    row = db.execute(
        """
        SELECT
            COUNT(*) AS total_assets,
            SUM(CASE WHEN owner_id IS NOT NULL THEN 1 ELSE 0 END) AS assets_with_owner,
            SUM(CASE WHEN owner_id IS NULL THEN 1 ELSE 0 END) AS assets_without_owner
        FROM assets
        """
    ).fetchone()
    return {key: int(row[key] or 0) for key in row.keys()}


@router.get(
    "/assets/risk-overview",
    response_model=AssetRiskStatistics,
    summary="场景 2：各资产漏洞和事件处置情况",
)
def asset_risk_overview(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    assets = db.execute("SELECT id, asset_code, name FROM assets ORDER BY id").fetchall()
    vulnerability_counts = {
        row["asset_id"]: row["count"]
        for row in db.execute(
            "SELECT asset_id, COUNT(*) AS count FROM vulnerability_assets GROUP BY asset_id"
        ).fetchall()
    }
    event_counts = {
        row["asset_id"]: row["count"]
        for row in db.execute(
            "SELECT asset_id, COUNT(*) AS count FROM event_assets GROUP BY asset_id"
        ).fetchall()
    }
    status_by_asset: dict[int, dict[str, int]] = {
        row["id"]: {key: 0 for key in STATUS_KEYS} for row in assets
    }
    rows = db.execute(
        """
        SELECT asset_id, status, COUNT(*) AS count
        FROM (
            SELECT va.asset_id, v.status
            FROM vulnerability_assets va
            JOIN vulnerabilities v ON v.id = va.vulnerability_id
            UNION ALL
            SELECT ea.asset_id, e.status
            FROM event_assets ea
            JOIN security_events e ON e.id = ea.event_id
        ) linked_risks
        GROUP BY asset_id, status
        """
    ).fetchall()
    for row in rows:
        status_by_asset.setdefault(
            row["asset_id"], {key: 0 for key in STATUS_KEYS}
        )[row["status"]] = row["count"]

    items = []
    for asset in assets:
        vulnerability_count = vulnerability_counts.get(asset["id"], 0)
        event_count = event_counts.get(asset["id"], 0)
        items.append(
            {
                "asset_id": asset["id"],
                "asset_code": asset["asset_code"],
                "asset_name": asset["name"],
                "vulnerability_count": vulnerability_count,
                "event_count": event_count,
                "total_count": vulnerability_count + event_count,
                "status": status_by_asset[asset["id"]],
            }
        )

    vulnerability_total = db.execute(
        "SELECT COUNT(*) AS count FROM vulnerabilities"
    ).fetchone()["count"]
    event_total = db.execute("SELECT COUNT(*) AS count FROM security_events").fetchone()[
        "count"
    ]
    overall_rows = db.execute(
        """
        SELECT status AS key, COUNT(*) AS count
        FROM (
            SELECT status FROM vulnerabilities
            UNION ALL
            SELECT status FROM security_events
        ) all_risks
        GROUP BY status
        """
    ).fetchall()
    return {
        "total_assets": len(assets),
        "total_vulnerabilities": vulnerability_total,
        "total_events": event_total,
        "status": normalized_counts(overall_rows, STATUS_KEYS),
        "assets": items,
    }


@router.get(
    "/security-events/distribution",
    response_model=DistributionStatistics,
    summary="场景 3：安全事件等级与处置状态分布",
)
def event_distribution(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    total = db.execute("SELECT COUNT(*) AS count FROM security_events").fetchone()["count"]
    return {
        "total": total,
        "severity": _group_counts(db, "security_events", "severity", SEVERITY_KEYS),
        "status": _group_counts(db, "security_events", "status", STATUS_KEYS),
    }


@router.get(
    "/vulnerabilities/distribution",
    response_model=DistributionStatistics,
    summary="场景 4：安全漏洞等级与处置状态分布",
)
def vulnerability_distribution(
    db: Db,
    _: Annotated[dict, Depends(require_action("read"))],
) -> dict:
    total = db.execute("SELECT COUNT(*) AS count FROM vulnerabilities").fetchone()["count"]
    return {
        "total": total,
        "severity": _group_counts(db, "vulnerabilities", "severity", SEVERITY_KEYS),
        "status": _group_counts(db, "vulnerabilities", "status", STATUS_KEYS),
    }

from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import HTTPException


SEVERITY_KEYS = ("critical", "high", "medium", "low", "info")
STATUS_KEYS = ("closed", "responding", "no_response")


def user_from_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    result.pop("password_hash", None)
    result["is_active"] = bool(result["is_active"])
    return result


def asset_from_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    result["tags"] = json.loads(result.get("tags") or "[]")
    return result


def linked_ids(
    db: sqlite3.Connection,
    table: str,
    entity_column: str,
    entity_id: int,
) -> list[int]:
    rows = db.execute(
        f"SELECT asset_id FROM {table} WHERE {entity_column} = ? ORDER BY asset_id",
        (entity_id,),
    ).fetchall()
    return [row["asset_id"] for row in rows]


def vulnerability_from_row(
    db: sqlite3.Connection, row: sqlite3.Row | dict[str, Any]
) -> dict[str, Any]:
    result = dict(row)
    result["asset_ids"] = linked_ids(
        db, "vulnerability_assets", "vulnerability_id", result["id"]
    )
    return result


def event_from_row(
    db: sqlite3.Connection, row: sqlite3.Row | dict[str, Any]
) -> dict[str, Any]:
    result = dict(row)
    result["asset_ids"] = linked_ids(db, "event_assets", "event_id", result["id"])
    return result


def ensure_row(
    db: sqlite3.Connection, table: str, entity_id: int, label: str
) -> sqlite3.Row:
    row = db.execute(f"SELECT * FROM {table} WHERE id = ?", (entity_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label}不存在")
    return row


def ensure_asset_ids(db: sqlite3.Connection, asset_ids: list[int]) -> list[int]:
    unique_ids = list(dict.fromkeys(asset_ids))
    if not unique_ids:
        return []
    placeholders = ",".join("?" for _ in unique_ids)
    found = {
        row["id"]
        for row in db.execute(
            f"SELECT id FROM assets WHERE id IN ({placeholders})", unique_ids
        ).fetchall()
    }
    missing = [asset_id for asset_id in unique_ids if asset_id not in found]
    if missing:
        raise HTTPException(status_code=422, detail=f"资产 ID 不存在: {missing}")
    return unique_ids


def replace_asset_links(
    db: sqlite3.Connection,
    table: str,
    entity_column: str,
    entity_id: int,
    asset_ids: list[int],
) -> None:
    ids = ensure_asset_ids(db, asset_ids)
    db.execute(f"DELETE FROM {table} WHERE {entity_column} = ?", (entity_id,))
    db.executemany(
        f"INSERT INTO {table} ({entity_column}, asset_id) VALUES (?, ?)",
        [(entity_id, asset_id) for asset_id in ids],
    )


def insert_record(db: sqlite3.Connection, table: str, data: dict[str, Any]) -> int:
    columns = list(data)
    placeholders = ", ".join("?" for _ in columns)
    try:
        cursor = db.execute(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
            tuple(data[column] for column in columns),
        )
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="唯一字段冲突或关联对象不存在"
        ) from exc
    return int(cursor.lastrowid)


def update_record(
    db: sqlite3.Connection, table: str, entity_id: int, data: dict[str, Any]
) -> None:
    if not data:
        return
    assignments = ", ".join(f"{column} = ?" for column in data)
    try:
        db.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ?",
            (*data.values(), entity_id),
        )
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409, detail="唯一字段冲突或关联对象不存在"
        ) from exc


def commit_or_conflict(db: sqlite3.Connection, detail: str = "唯一字段冲突或关联对象不存在") -> None:
    try:
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=detail) from exc


def normalized_counts(rows: list[sqlite3.Row], keys: tuple[str, ...]) -> dict[str, int]:
    result = {key: 0 for key in keys}
    result.update({row["key"]: row["count"] for row in rows})
    return result

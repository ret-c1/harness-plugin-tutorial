from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import HTTPException


def record_from_row(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    result = dict(row)
    result["metadata"] = json.loads(result.get("metadata") or "{}")
    if "memory_key" in result:
        result["key"] = result.pop("memory_key")
    return result


def ensure_owned_row(
    db: sqlite3.Connection,
    table: str,
    entity_id: int,
    user_id: int,
    label: str,
) -> sqlite3.Row:
    row = db.execute(
        f"SELECT * FROM {table} WHERE id = ? AND user_id = ?",
        (entity_id, user_id),
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"{label}不存在")
    return row


def insert_record(
    db: sqlite3.Connection,
    table: str,
    data: dict[str, Any],
    conflict_detail: str,
) -> int:
    columns = list(data)
    placeholders = ", ".join("?" for _ in columns)
    try:
        cursor = db.execute(
            f"INSERT INTO {table} ({', '.join(columns)}) VALUES ({placeholders})",
            tuple(data[column] for column in columns),
        )
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail) from exc
    return int(cursor.lastrowid)


def update_record(
    db: sqlite3.Connection,
    table: str,
    entity_id: int,
    user_id: int,
    data: dict[str, Any],
    conflict_detail: str,
) -> None:
    assignments = ", ".join(f"{column} = ?" for column in data)
    try:
        db.execute(
            f"UPDATE {table} SET {assignments} WHERE id = ? AND user_id = ?",
            (*data.values(), entity_id, user_id),
        )
        db.commit()
    except sqlite3.IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail=conflict_detail) from exc


def delete_owned_record(
    db: sqlite3.Connection,
    table: str,
    entity_id: int,
    user_id: int,
    label: str,
) -> None:
    ensure_owned_row(db, table, entity_id, user_id, label)
    db.execute(f"DELETE FROM {table} WHERE id = ? AND user_id = ?", (entity_id, user_id))
    db.commit()


def json_metadata(value: dict[str, Any]) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))

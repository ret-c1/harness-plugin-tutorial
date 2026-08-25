from __future__ import annotations

from datetime import UTC, datetime
from enum import StrEnum
from typing import Any

from pydantic import Field

from app.schemas import APIModel


class UserMemoryBase(APIModel):
    key: str = Field(min_length=1, max_length=128, examples=["response_language"])
    content: str = Field(min_length=1, max_length=100_000, examples=["优先使用中文回答"])
    metadata: dict[str, Any] = Field(default_factory=dict)


class UserMemoryCreate(UserMemoryBase):
    pass


class UserMemoryUpdate(APIModel):
    key: str | None = Field(default=None, min_length=1, max_length=128)
    content: str | None = Field(default=None, min_length=1, max_length=100_000)
    metadata: dict[str, Any] | None = None


class UserMemoryRead(UserMemoryBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


class ProjectMemoryBase(UserMemoryBase):
    project_id: str = Field(min_length=1, max_length=256, examples=["harness-plugin-lib"])


class ProjectMemoryCreate(ProjectMemoryBase):
    pass


class ProjectMemoryUpdate(APIModel):
    project_id: str | None = Field(default=None, min_length=1, max_length=256)
    key: str | None = Field(default=None, min_length=1, max_length=128)
    content: str | None = Field(default=None, min_length=1, max_length=100_000)
    metadata: dict[str, Any] | None = None


class ProjectMemoryRead(ProjectMemoryBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime


class TaskStatus(StrEnum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class TaskHistoryBase(APIModel):
    task_id: str = Field(min_length=1, max_length=128, examples=["task-20260821-001"])
    project_id: str | None = Field(default=None, max_length=256)
    session_id: str | None = Field(default=None, max_length=128)
    title: str = Field(min_length=1, max_length=300)
    task_input: str = Field(min_length=1, max_length=100_000)
    task_output: str | None = Field(default=None, max_length=100_000)
    status: TaskStatus = TaskStatus.COMPLETED
    started_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    completed_at: datetime | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class TaskHistoryCreate(TaskHistoryBase):
    pass


class TaskHistoryUpdate(APIModel):
    task_id: str | None = Field(default=None, min_length=1, max_length=128)
    project_id: str | None = Field(default=None, max_length=256)
    session_id: str | None = Field(default=None, max_length=128)
    title: str | None = Field(default=None, min_length=1, max_length=300)
    task_input: str | None = Field(default=None, min_length=1, max_length=100_000)
    task_output: str | None = Field(default=None, max_length=100_000)
    status: TaskStatus | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    metadata: dict[str, Any] | None = None


class TaskHistoryRead(TaskHistoryBase):
    id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

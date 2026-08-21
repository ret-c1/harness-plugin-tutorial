from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict


class APIModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


T = TypeVar("T")


class Page(APIModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int


class HealthResponse(APIModel):
    status: str
    database: str


class MessageResponse(APIModel):
    message: str

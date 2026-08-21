from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DATABASE_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("JWT_SECRET", "test-secret-that-is-long-and-not-for-production")
    monkeypatch.setenv("SEED_DEFAULT_USERS", "true")
    with TestClient(app) as test_client:
        yield test_client

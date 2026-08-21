"""Memory 模块接口与用户隔离测试。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient


def login(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_user_memory_is_isolated_by_authenticated_user(client: TestClient):
    admin = login(client, "admin", "Admin@123")
    user_a = login(client, "user_a", "UserA@123")
    user_b = login(client, "user_b", "UserB@123")

    admin_memory = client.post(
        "/api/v1/memory/user-memories",
        headers=admin,
        json={
            "key": "response_language",
            "content": "优先使用中文回答",
            "metadata": {"source": "explicit"},
        },
    )
    assert admin_memory.status_code == 201, admin_memory.text
    assert admin_memory.json()["user_id"] == 1

    same_key_for_another_user = client.post(
        "/api/v1/memory/user-memories",
        headers=user_a,
        json={"key": "response_language", "content": "Use English"},
    )
    assert same_key_for_another_user.status_code == 201
    assert same_key_for_another_user.json()["user_id"] == 2

    # user_b 在安全业务模块中是只读角色，但仍可维护自己的个人记忆。
    user_b_memory = client.post(
        "/api/v1/memory/user-memories",
        headers=user_b,
        json={"key": "answer_style", "content": "简洁"},
    )
    assert user_b_memory.status_code == 201

    memory_id = admin_memory.json()["id"]
    assert (
        client.get(f"/api/v1/memory/user-memories/{memory_id}", headers=user_a).status_code
        == 404
    )
    admin_list = client.get("/api/v1/memory/user-memories", headers=admin).json()
    assert admin_list["total"] == 1
    assert [item["content"] for item in admin_list["items"]] == ["优先使用中文回答"]

    updated = client.patch(
        f"/api/v1/memory/user-memories/{memory_id}",
        headers=admin,
        json={"content": "始终使用中文回答"},
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "始终使用中文回答"

    duplicate = client.post(
        "/api/v1/memory/user-memories",
        headers=admin,
        json={"key": "response_language", "content": "重复"},
    )
    assert duplicate.status_code == 409


def test_project_memory_and_task_history_are_user_scoped(client: TestClient):
    admin = login(client, "admin", "Admin@123")
    user_a = login(client, "user_a", "UserA@123")

    payload = {
        "project_id": "security-harness-plugin",
        "key": "api_contract",
        "content": "API 路径保持向后兼容",
    }
    admin_project = client.post(
        "/api/v1/memory/project-memories", headers=admin, json=payload
    )
    user_a_project = client.post(
        "/api/v1/memory/project-memories", headers=user_a, json=payload
    )
    assert admin_project.status_code == 201, admin_project.text
    assert user_a_project.status_code == 201, user_a_project.text
    assert admin_project.json()["user_id"] != user_a_project.json()["user_id"]
    assert (
        client.get(
            f"/api/v1/memory/project-memories/{admin_project.json()['id']}",
            headers=user_a,
        ).status_code
        == 404
    )

    filtered = client.get(
        "/api/v1/memory/project-memories",
        headers=admin,
        params={"project_id": "security-harness-plugin"},
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == 1

    task_payload = {
        "task_id": "task-001",
        "project_id": "security-harness-plugin",
        "session_id": "session-001",
        "title": "模块化 API",
        "task_input": "新增 memory API",
        "task_output": "接口已完成",
        "status": "completed",
        "started_at": datetime.now(UTC).isoformat(),
        "metadata": {"model": "test"},
    }
    admin_task = client.post(
        "/api/v1/memory/task-history", headers=admin, json=task_payload
    )
    user_a_task = client.post(
        "/api/v1/memory/task-history", headers=user_a, json=task_payload
    )
    assert admin_task.status_code == 201, admin_task.text
    assert user_a_task.status_code == 201, user_a_task.text
    assert admin_task.json()["completed_at"] is not None
    assert (
        client.get(
            f"/api/v1/memory/task-history/{admin_task.json()['id']}", headers=user_a
        ).status_code
        == 404
    )

    running = client.patch(
        f"/api/v1/memory/task-history/{admin_task.json()['id']}",
        headers=admin,
        json={"status": "running", "task_output": None},
    )
    assert running.status_code == 200, running.text
    assert running.json()["completed_at"] is None
    assert running.json()["task_output"] is None

    failed = client.patch(
        f"/api/v1/memory/task-history/{admin_task.json()['id']}",
        headers=admin,
        json={"status": "failed", "task_output": "测试失败"},
    )
    assert failed.status_code == 200
    assert failed.json()["completed_at"] is not None


def test_memory_api_rejects_unauthenticated_or_spoofed_user(client: TestClient):
    assert client.get("/api/v1/memory/user-memories").status_code == 401

    admin = login(client, "admin", "Admin@123")
    response = client.post(
        "/api/v1/memory/user-memories",
        headers=admin,
        json={"user_id": 2, "key": "spoof", "content": "不能指定其他用户"},
    )
    assert response.status_code == 422

    openapi = client.get("/openapi.json").json()
    assert "/api/v1/memory/user-memories" in openapi["paths"]
    assert "/api/v1/memory/project-memories" in openapi["paths"]
    assert "/api/v1/memory/task-history" in openapi["paths"]

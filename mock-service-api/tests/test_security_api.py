"""Security 模块接口回归测试。"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi.testclient import TestClient

def login(client: TestClient, username: str, password: str) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def create_asset(client: TestClient, headers: dict[str, str], code: str = "ASSET-001"):
    response = client.post(
        "/api/v1/assets",
        headers=headers,
        json={
            "asset_code": code,
            "name": "公网 Web 服务器",
            "asset_type": "server",
            "ip_address": "203.0.113.10",
            "hostname": "web-01",
            "criticality": "critical",
            "exposure": "internet",
            "status": "active",
            "tags": ["production", "dmz"],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_login_and_role_permissions(client: TestClient):
    admin = login(client, "admin", "Admin@123")
    user_a = login(client, "user_a", "UserA@123")
    user_b = login(client, "user_b", "UserB@123")

    asset = create_asset(client, admin)
    response = client.patch(
        f"/api/v1/assets/{asset['id']}",
        headers=user_a,
        json={"description": "由 user_a 更新"},
    )
    assert response.status_code == 200
    assert response.json()["description"] == "由 user_a 更新"

    assert client.get(f"/api/v1/assets/{asset['id']}", headers=user_b).status_code == 200
    assert (
        client.post(
            "/api/v1/assets",
            headers=user_b,
            json={
                "asset_code": "DENIED",
                "name": "denied",
                "asset_type": "other",
            },
        ).status_code
        == 403
    )
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=user_a).status_code == 403
    assert client.delete(f"/api/v1/assets/{asset['id']}", headers=admin).status_code == 204


def test_relationships_and_statistics(client: TestClient):
    admin = login(client, "admin", "Admin@123")
    asset = create_asset(client, admin)
    second_asset = create_asset(client, admin, "ASSET-002")
    now = datetime.now(UTC).isoformat()

    vulnerability = client.post(
        "/api/v1/vulnerabilities",
        headers=admin,
        json={
            "vuln_code": "VULN-001",
            "name": "OpenSSL 高危漏洞",
            "cve_id": "CVE-2026-0001",
            "severity": "critical",
            "cvss_score": 9.8,
            "discovered_at": now,
            "status": "responding",
            "asset_ids": [asset["id"], second_asset["id"]],
        },
    )
    assert vulnerability.status_code == 201, vulnerability.text

    event = client.post(
        "/api/v1/security-events",
        headers=admin,
        json={
            "event_code": "EVENT-001",
            "title": "暴力破解告警",
            "category": "authentication_attack",
            "severity": "high",
            "source_ip": "198.51.100.20",
            "destination_ip": "203.0.113.10",
            "occurred_at": now,
            "detected_at": now,
            "status": "closed",
            "asset_ids": [asset["id"]],
        },
    )
    assert event.status_code == 201, event.text
    assert event.json()["closed_at"] is not None

    detail = client.get(f"/api/v1/assets/{asset['id']}", headers=admin)
    assert detail.status_code == 200
    assert len(detail.json()["vulnerabilities"]) == 1
    assert len(detail.json()["security_events"]) == 1

    ownership = client.get("/api/v1/statistics/assets/ownership", headers=admin).json()
    assert ownership == {
        "total_assets": 2,
        "assets_with_owner": 0,
        "assets_without_owner": 2,
    }

    risk = client.get("/api/v1/statistics/assets/risk-overview", headers=admin).json()
    assert risk["total_assets"] == 2
    assert risk["total_vulnerabilities"] == 1
    assert risk["total_events"] == 1
    assert risk["status"] == {"closed": 1, "responding": 1, "no_response": 0}

    event_distribution = client.get(
        "/api/v1/statistics/security-events/distribution", headers=admin
    ).json()
    assert event_distribution["severity"]["high"] == 1
    assert event_distribution["status"]["closed"] == 1

    vuln_distribution = client.get(
        "/api/v1/statistics/vulnerabilities/distribution", headers=admin
    ).json()
    assert vuln_distribution["severity"]["critical"] == 1
    assert vuln_distribution["status"]["responding"] == 1

    vulnerability_id = vulnerability.json()["id"]
    updated_vulnerability = client.patch(
        f"/api/v1/vulnerabilities/{vulnerability_id}",
        headers=admin,
        json={"status": "closed", "solution": "已升级修复"},
    )
    assert updated_vulnerability.status_code == 200
    assert updated_vulnerability.json()["closed_at"] is not None

    event_id = event.json()["id"]
    updated_event = client.patch(
        f"/api/v1/security-events/{event_id}",
        headers=admin,
        json={"response_summary": "已封禁攻击源"},
    )
    assert updated_event.status_code == 200
    assert updated_event.json()["response_summary"] == "已封禁攻击源"
    assert client.delete(f"/api/v1/vulnerabilities/{vulnerability_id}", headers=admin).status_code == 204
    assert client.delete(f"/api/v1/security-events/{event_id}", headers=admin).status_code == 204


def test_user_a_cannot_escalate_role(client: TestClient):
    user_a = login(client, "user_a", "UserA@123")
    response = client.post(
        "/api/v1/users",
        headers=user_a,
        json={
            "username": "attempted_admin",
            "password": "SomePassword@123",
            "name": "越权账号",
            "email": "attempted@example.com",
            "role": "admin",
        },
    )
    assert response.status_code == 403


def test_admin_user_crud_and_password_reset(client: TestClient):
    admin = login(client, "admin", "Admin@123")
    created = client.post(
        "/api/v1/users",
        headers=admin,
        json={
            "username": "analyst",
            "password": "InitialPassword@123",
            "name": "安全分析师",
            "nickname": "analyst-1",
            "phone": "13800000000",
            "email": "analyst@example.com",
            "department": "安全运营中心",
            "job_title": "分析师",
            "role": "user_b",
        },
    )
    assert created.status_code == 201, created.text
    user_id = created.json()["id"]
    assert "password" not in created.json()

    updated = client.patch(
        f"/api/v1/users/{user_id}",
        headers=admin,
        json={"role": "user_a", "job_title": "高级分析师"},
    )
    assert updated.status_code == 200
    assert updated.json()["role"] == "user_a"

    reset = client.put(
        f"/api/v1/users/{user_id}/password",
        headers=admin,
        json={"new_password": "ChangedPassword@123"},
    )
    assert reset.status_code == 204
    login(client, "analyst", "ChangedPassword@123")
    assert client.delete(f"/api/v1/users/{user_id}", headers=admin).status_code == 204


def test_invalid_token_is_rejected(client: TestClient):
    response = client.get(
        "/api/v1/assets", headers={"Authorization": "Bearer invalid.token.value"}
    )
    assert response.status_code == 401

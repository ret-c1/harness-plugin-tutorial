# DeepSeek Harness 模块化测试 API

一个面向 DeepSeek Harness/其他 HTTP 客户端的 Python 3 API 服务。接口按业务模块组织：`security` 模块提供用户登录、权限控制以及资产、漏洞、安全事件和统计接口；`memory` 模块提供 Memory 插件联调所需的 User Memory、Project Memory 与 Task History。服务使用 FastAPI，数据保存在 SQLite 中，启动后自动生成 OpenAPI 定义。

## 快速启动

要求 Python 3.11 或更高版本。

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt

export JWT_SECRET='替换为至少 32 字节的随机字符串'
python3 run.py
```

也可以使用 Uvicorn 启动并启用热更新：

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

启动后的地址：

- API 根地址：`http://127.0.0.1:8000/api/v1`
- Swagger 接口文档：`http://127.0.0.1:8000/docs`
- OpenAPI JSON：`http://127.0.0.1:8000/openapi.json`
- 健康检查：`http://127.0.0.1:8000/health`

## 模块结构

```text
app/
├── modules/
│   ├── security/              # 现有网络安全接口的统一入口和数据库定义
│   │   └── routers/           # 用户、资产、漏洞、事件和统计资源路由
│   └── memory/                # Memory 模型、数据表、仓储与三类接口
├── database.py                # 连接管理并初始化各模块数据表
└── main.py                    # 仅负责应用配置和模块挂载
```

两个模块共享 `/api/v1` 版本前缀。现有 Security API 路径保持不变；Memory API 使用 `/api/v1/memory` 前缀。新增业务模块时应在 `app/modules/<name>/` 内维护自己的数据表定义、请求/响应模型和路由，再由 `app/main.py` 统一挂载。

SQLite 文件默认创建在 `./data/security.db`。可通过环境变量修改配置：

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `DATABASE_PATH` | `./data/security.db` | SQLite 文件路径 |
| `JWT_SECRET` | 开发用固定值 | JWT 签名密钥，部署前必须更换 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `480` | Token 有效分钟数 |
| `SEED_DEFAULT_USERS` | `true` | 首次启动是否创建三个初始账号 |
| `CORS_ORIGINS` | `*` | 逗号分隔的允许来源 |
| `APP_NAME` | `DeepSeek Harness Security API` | OpenAPI 服务名称 |

仓库提供了 [.env.example](.env.example)。项目不自动加载 `.env`；需要用部署环境注入变量，或在本地执行 `set -a; source .env; set +a` 后启动。

## 初始账号

首次启动会创建以下账号；生产环境应立即修改密码，或设置 `SEED_DEFAULT_USERS=false` 后自行初始化用户。

| 角色 | 用户名 | 初始密码 | 权限 |
|---|---|---|---|
| 管理员 | `admin` | `Admin@123` | 查询、新增、修改、删除 |
| 用户 A | `user_a` | `UserA@123` | 查询、新增、修改，无删除权限 |
| 用户 B | `user_b` | `UserB@123` | 只读查询 |

权限应用于用户、资产、漏洞和事件 API。为避免权限提升，`user_a` 创建用户时只能创建 `user_b`；角色、启停状态以及重置他人密码仅管理员可操作。

## 认证方式

登录：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123"}'
```

响应中的 `access_token` 用作后续请求的 Bearer Token：

```bash
curl http://127.0.0.1:8000/api/v1/assets \
  -H 'Authorization: Bearer <access_token>'
```

DeepSeek Harness 只需以 HTTP 工具调用上述 Base URL，并在除登录、健康检查以外的请求中附加该请求头。接口结构也可直接从 `/openapi.json` 导入。

## 接口定义

所有业务接口前缀均为 `/api/v1`。列表接口统一返回：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 20
}
```

### 认证与用户

| 方法 | 路径 | 功能 | 权限 |
|---|---|---|---|
| `POST` | `/auth/login` | 用户名密码登录 | 公开 |
| `GET` | `/auth/me` | 当前登录用户 | 已登录 |
| `PUT` | `/auth/password` | 修改自己的密码 | 已登录 |
| `GET` | `/users` | 分页查询用户 | read |
| `GET` | `/users/{id}` | 用户详情 | read |
| `POST` | `/users` | 新增用户 | create |
| `PATCH` | `/users/{id}` | 修改用户 | update |
| `PUT` | `/users/{id}/password` | 重置用户密码 | 仅管理员 |
| `DELETE` | `/users/{id}` | 删除用户 | delete/管理员 |

用户字段：`username`、`name`、`nickname`、`phone`、`email`、`department`、`job_title`、`role`、`is_active`、`last_login_at`、`created_at`、`updated_at`。密码只保存 PBKDF2-SHA256 哈希，不在任何查询响应中返回。

角色枚举：`admin`、`user_a`、`user_b`。

### 资产管理

| 方法 | 路径 | 功能 | 权限 |
|---|---|---|---|
| `GET` | `/assets` | 分页/条件查询资产 | read |
| `GET` | `/assets/{id}` | 资产详情，包含关联漏洞和事件 | read |
| `GET` | `/assets/{id}/vulnerabilities` | 只查该资产的关联漏洞 | read |
| `GET` | `/assets/{id}/security-events` | 只查该资产的关联事件 | read |
| `POST` | `/assets` | 新增资产 | create |
| `PATCH` | `/assets/{id}` | 修改资产 | update |
| `DELETE` | `/assets/{id}` | 删除资产 | delete/管理员 |

资产的主要安全字段：

| 字段 | 类型/枚举 | 说明 |
|---|---|---|
| `asset_code` | string | 唯一资产编码 |
| `name` | string | 资产名称 |
| `asset_type` | `server/network_device/database/cloud/container/application/endpoint/other` | 资产类型 |
| `ip_address`、`hostname`、`mac_address` | string | 网络标识 |
| `operating_system`、`vendor`、`model` | string | 系统与设备信息 |
| `location`、`department` | string | 位置和所属部门 |
| `owner_id` | integer/null | 责任人用户 ID |
| `criticality` | `critical/high/medium/low` | 业务重要程度 |
| `exposure` | `internet/intranet/isolated` | 暴露面 |
| `security_zone` | string | 安全域 |
| `status` | `active/offline/retired` | 资产状态 |
| `tags` | string[] | 标签 |

创建资产示例：

```json
{
  "asset_code": "ASSET-001",
  "name": "生产 Web 服务器",
  "asset_type": "server",
  "ip_address": "203.0.113.10",
  "hostname": "web-01",
  "operating_system": "Ubuntu 24.04",
  "owner_id": 2,
  "criticality": "critical",
  "exposure": "internet",
  "security_zone": "DMZ",
  "status": "active",
  "tags": ["production", "web"]
}
```

### 漏洞管理

| 方法 | 路径 | 功能 | 权限 |
|---|---|---|---|
| `GET` | `/vulnerabilities` | 分页/条件查询漏洞 | read |
| `GET` | `/vulnerabilities/{id}` | 漏洞详情 | read |
| `POST` | `/vulnerabilities` | 新增漏洞并关联资产 | create |
| `PATCH` | `/vulnerabilities/{id}` | 修改漏洞或重建资产关联 | update |
| `DELETE` | `/vulnerabilities/{id}` | 删除漏洞 | delete/管理员 |

主要字段：`vuln_code`、`name`、`cve_id`、`cnnvd_id`、`severity`、`cvss_score`、`vuln_type`、`source`、`description`、`solution`、`discovered_at`、`due_at`、`status`、`assignee_id`、`closed_at`、`asset_ids`。

创建漏洞示例：

```json
{
  "vuln_code": "VULN-001",
  "name": "OpenSSL 高危漏洞",
  "cve_id": "CVE-2026-0001",
  "severity": "critical",
  "cvss_score": 9.8,
  "vuln_type": "remote_code_execution",
  "source": "scanner",
  "description": "漏洞说明",
  "solution": "升级至安全版本",
  "discovered_at": "2026-08-20T10:00:00+08:00",
  "due_at": "2026-08-21T18:00:00+08:00",
  "status": "responding",
  "assignee_id": 2,
  "asset_ids": [1, 2]
}
```

### 安全事件管理

| 方法 | 路径 | 功能 | 权限 |
|---|---|---|---|
| `GET` | `/security-events` | 分页/条件查询事件 | read |
| `GET` | `/security-events/{id}` | 安全事件详情 | read |
| `POST` | `/security-events` | 新增事件并关联资产 | create |
| `PATCH` | `/security-events/{id}` | 修改事件或重建资产关联 | update |
| `DELETE` | `/security-events/{id}` | 删除事件 | delete/管理员 |

主要字段：`event_code`、`title`、`category`、`severity`、`source`、`source_ip`、`destination_ip`、`description`、`occurred_at`、`detected_at`、`status`、`assignee_id`、`response_summary`、`closed_at`、`asset_ids`。

创建事件示例：

```json
{
  "event_code": "EVENT-001",
  "title": "公网 SSH 暴力破解",
  "category": "authentication_attack",
  "severity": "high",
  "source": "SIEM",
  "source_ip": "198.51.100.20",
  "destination_ip": "203.0.113.10",
  "description": "5 分钟内出现大量失败登录",
  "occurred_at": "2026-08-20T12:00:00+08:00",
  "detected_at": "2026-08-20T12:01:00+08:00",
  "status": "no_response",
  "asset_ids": [1]
}
```

漏洞和事件等级均使用 `critical/high/medium/low/info`；处置状态均使用：

- `no_response`：无响应
- `responding`：响应/处置中
- `closed`：已闭环

状态修改为 `closed` 且未提供 `closed_at` 时，服务自动记录当前时间；重新打开时自动清空 `closed_at`。

### 统计场景

| 方法 | 路径 | 返回内容 |
|---|---|---|
| `GET` | `/statistics/assets/ownership` | 资产总数、有责任人数量、无责任人数量 |
| `GET` | `/statistics/assets/risk-overview` | 漏洞/事件总数、整体处置数，以及每个资产的关联漏洞/事件和处置数 |
| `GET` | `/statistics/security-events/distribution` | 事件总数、等级分布、闭环/响应中/无响应数量 |
| `GET` | `/statistics/vulnerabilities/distribution` | 漏洞总数、等级分布、闭环/响应中/无响应数量 |

统计响应始终补齐所有等级和状态键；即使某个等级没有数据也会返回 `0`，方便 Harness 直接消费。

资产风险概览响应示例：

```json
{
  "total_assets": 1,
  "total_vulnerabilities": 2,
  "total_events": 1,
  "status": {"closed": 1, "responding": 1, "no_response": 1},
  "assets": [
    {
      "asset_id": 1,
      "asset_code": "ASSET-001",
      "asset_name": "生产 Web 服务器",
      "vulnerability_count": 2,
      "event_count": 1,
      "total_count": 3,
      "status": {"closed": 1, "responding": 1, "no_response": 1}
    }
  ]
}
```

### Memory 插件联调

Memory 接口按 Bearer Token 中的当前用户严格隔离。请求体不接受 `user_id`，服务端会自动写入当前用户 ID；查询详情、修改或删除其他用户的数据统一返回 `404`，避免暴露记录是否存在。该规则同样适用于管理员。

Memory 是用户个人数据，因此所有已登录且启用的账号均可维护自己的记忆，不沿用 Security 模块的角色写权限。例如，只读业务角色 `user_b` 仍可创建、修改和删除自己的 Memory 数据。

Harness 侧一个 Memory 插件实例只能绑定一个 API 账号。多用户部署应为每个用户分配独立的 scoped 实例或 profile，不能让模型选择 `user_id`。插件配置、工具列表和异常处理见 [`../security-harness-plugin/plugins/memory/README.md`](../security-harness-plugin/plugins/memory/README.md)。

#### User Memory

用于保存跨项目生效的用户偏好和稳定事实。同一用户下 `key` 唯一，不同用户可使用相同 `key`。

| 方法 | 路径 | 功能 |
|---|---|---|
| `GET` | `/memory/user-memories` | 分页查询当前用户的记忆，支持 `search` |
| `GET` | `/memory/user-memories/{id}` | 查询当前用户的记忆详情 |
| `POST` | `/memory/user-memories` | 创建记忆 |
| `PATCH` | `/memory/user-memories/{id}` | 修改记忆 |
| `DELETE` | `/memory/user-memories/{id}` | 删除记忆 |

主要字段：`key`、`content`、`metadata`；响应另含服务端生成的 `id`、`user_id`、`created_at` 和 `updated_at`。

```json
{
  "key": "response_language",
  "content": "优先使用中文回答",
  "metadata": {"source": "explicit"}
}
```

#### Project Memory

用于保存某个用户在特定项目中的约定、决策和上下文。同一用户和同一 `project_id` 下 `key` 唯一；不同用户或不同项目可使用相同 `key`。

| 方法 | 路径 | 功能 |
|---|---|---|
| `GET` | `/memory/project-memories` | 分页查询当前用户的项目记忆，支持 `project_id`、`search` |
| `GET` | `/memory/project-memories/{id}` | 查询当前用户的项目记忆详情 |
| `POST` | `/memory/project-memories` | 创建项目记忆 |
| `PATCH` | `/memory/project-memories/{id}` | 修改项目记忆 |
| `DELETE` | `/memory/project-memories/{id}` | 删除项目记忆 |

```json
{
  "project_id": "security-harness-plugin",
  "key": "api_contract",
  "content": "现有 API 路径保持向后兼容",
  "metadata": {"category": "decision"}
}
```

#### Task History

用于记录用户级任务执行历史，可通过 `project_id` 和 `session_id` 关联到项目与 Harness 会话。同一用户下 `task_id` 唯一，不同用户可使用相同 `task_id`。

| 方法 | 路径 | 功能 |
|---|---|---|
| `GET` | `/memory/task-history` | 分页查询当前用户的任务历史，支持 `project_id`、`session_id`、`status`、`search` |
| `GET` | `/memory/task-history/{id}` | 查询当前用户的任务详情 |
| `POST` | `/memory/task-history` | 创建任务历史 |
| `PATCH` | `/memory/task-history/{id}` | 修改任务历史或执行状态 |
| `DELETE` | `/memory/task-history/{id}` | 删除任务历史 |

状态枚举：`pending`、`running`、`completed`、`failed`、`cancelled`。创建或更新为终态且未提供 `completed_at` 时，服务自动记录当前时间；改回 `pending` 或 `running` 时自动清空 `completed_at`。

```json
{
  "task_id": "task-20260821-001",
  "project_id": "security-harness-plugin",
  "session_id": "session-001",
  "title": "模块化测试 API",
  "task_input": "新增 Memory 插件联调接口",
  "task_output": "接口和测试已完成",
  "status": "completed",
  "started_at": "2026-08-21T10:00:00+08:00",
  "metadata": {"source": "harness"}
}
```

## 查询参数与错误码

列表接口支持 `page`、`page_size`（最大 100）以及资源对应的 `search`、`status`、`severity`、`asset_id` 等过滤条件；具体定义和枚举可在 `/docs` 中直接试用。

| 状态码 | 含义 |
|---|---|
| `200/201/204` | 查询/创建/无正文操作成功 |
| `400` | 业务参数不合理或空 PATCH |
| `401` | 未登录、Token 无效或过期 |
| `403` | 当前角色无权执行操作 |
| `404` | 资源不存在 |
| `409` | 唯一字段冲突或关联约束冲突 |
| `422` | 请求字段校验失败或关联 ID 无效 |
| `408/429` | 请求超时或上游限流（由网关或部署环境返回） |
| `5xx` | 服务端或上游服务异常 |

## 测试

```bash
python3 -m pip install -r requirements-dev.txt
pytest -q
```

测试使用临时 SQLite 文件，不会修改正式的 `data/security.db`。

# Mock Service API 开发提示词

你是一名资深 Python 后端工程师。请在当前仓库的 `mock-service-api/` 目录中实现并维护一个供 DeepSeek Harness 插件开发、自动化测试和本地演示使用的模块化 Mock API。

## 目标

使用 FastAPI 和 SQLite 提供两个互相独立、共享认证能力的业务模块：

1. `security`：用户、资产、漏洞、安全事件和统计接口。
2. `memory`：User Memory、Project Memory 和 Task History 接口。

服务必须可以独立启动，自动生成 OpenAPI 文档，并能被 Harness 插件通过 HTTP 和 Bearer Token 调用。它是测试服务，不要把 Harness 插件业务逻辑写进 API，也不要依赖或复制 Harness 核心代码。

## 技术与结构要求

- 使用 Python 3.11+、FastAPI、Pydantic、SQLite 和 JWT。
- 采用同步 SQLite 访问即可，数据库连接必须正确关闭。
- 应用入口保持轻量，只负责配置、中间件、生命周期和路由挂载。
- 业务实现按模块放置：

```text
mock-service-api/
├── app/
│   ├── modules/
│   │   ├── security/
│   │   │   └── routers/
│   │   └── memory/
│   ├── config.py
│   ├── database.py
│   ├── dependencies.py
│   ├── main.py
│   ├── schemas.py
│   └── security.py
├── data/
├── tests/
├── requirements.txt
├── requirements-dev.txt
└── run.py
```

- 所有业务接口使用 `/api/v1` 前缀；健康检查使用 `/health`。
- 启动时初始化数据表，并通过 FastAPI 自动提供 `/docs` 和 `/openapi.json`。
- 面向用户的接口摘要、错误信息和文档优先使用中文。
- 保持已有路径、字段和枚举向后兼容；如确需破坏兼容性，必须同步更新实现、测试、README 和 OpenAPI 描述。

## 配置要求

通过环境变量配置以下项目，并允许从 `mock-service-api/.env` 加载本地配置：

| 环境变量 | 用途 |
| --- | --- |
| `DATABASE_PATH` | SQLite 数据库文件路径 |
| `JWT_SECRET` | JWT 签名密钥 |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Access Token 有效期 |
| `SEED_DEFAULT_USERS` | 是否初始化本地联调账号 |
| `CORS_ORIGINS` | 允许的来源，逗号分隔 |
| `APP_NAME` | OpenAPI 服务名称 |

不得硬编码生产凭据、Token、私有地址或机器专属绝对路径。开发环境可提供明确标注的本地默认值，但使用默认 JWT 密钥启动时必须记录警告；日志和错误响应不得输出密码或完整 Token。`.env`、SQLite 数据库、虚拟环境和缓存不得提交。

## 认证与权限

- `POST /api/v1/auth/login` 使用用户名和密码登录并返回 Bearer Token。
- `GET /api/v1/auth/me` 返回当前登录用户。
- `PUT /api/v1/auth/password` 修改当前用户密码。
- 密码仅保存安全哈希，任何响应都不得返回密码或密码哈希。
- Token 无效、过期或账号停用时返回 `401`。
- Security 模块使用以下角色权限：

| 角色 | 权限 |
| --- | --- |
| `admin` | 查询、新增、修改、删除及管理员操作 |
| `user_a` | 查询、新增、修改，不允许删除 |
| `user_b` | 只读查询 |

- `user_a` 不得创建或提升管理员账号；重置他人密码、删除用户等管理员操作只能由 `admin` 执行。
- 默认账号和密码仅供本地联调，并在 README 中明确要求部署前更换。

## Security 模块

实现以下资源的分页 CRUD、条件过滤、详情查询和权限校验：

- 用户：`/api/v1/users`
- 资产：`/api/v1/assets`
- 漏洞：`/api/v1/vulnerabilities`
- 安全事件：`/api/v1/security-events`

### 资产

资产至少包含唯一资产编码、名称、类型、网络标识、操作系统、厂商、位置、部门、责任人、重要程度、暴露面、安全域、状态和标签。支持：

- 查询资产详情以及关联漏洞和事件。
- `GET /assets/{id}/vulnerabilities`。
- `GET /assets/{id}/security-events`。
- 资产类型：`server/network_device/database/cloud/container/application/endpoint/other`。
- 重要程度：`critical/high/medium/low`。
- 暴露面：`internet/intranet/isolated`。
- 状态：`active/offline/retired`。

### 漏洞与安全事件

- 漏洞和安全事件都可以关联多个资产。
- 创建和更新时校验全部关联资产 ID；无效关联不得产生部分写入。
- 等级统一为 `critical/high/medium/low/info`。
- 处置状态统一为 `no_response/responding/closed`。
- 状态改为 `closed` 且调用方未传 `closed_at` 时，自动写入当前时间。
- 从 `closed` 改回未完成状态时，自动清空 `closed_at`。
- 删除资产、漏洞或事件时正确处理关联表，不留下孤立关系。

### 统计接口

实现：

- `GET /statistics/assets/ownership`
- `GET /statistics/assets/risk-overview`
- `GET /statistics/security-events/distribution`
- `GET /statistics/vulnerabilities/distribution`

统计结果必须与当前数据库一致。等级与状态分布应始终补齐全部枚举键，无数据时返回 `0`。资产风险概览同时返回全局计数和逐资产的漏洞、事件及处置状态计数。

## Memory 模块

Memory 是当前登录用户的个人数据，不沿用 Security 模块的角色写权限：所有已登录且启用的账号都可以维护自己的 Memory，包括 Security 中只读的 `user_b`。

实现以下五类操作：列表、详情、创建、局部更新和删除。

### User Memory

路径：`/api/v1/memory/user-memories`

- 保存跨项目生效的稳定偏好或事实。
- 主要字段：`key`、`content`、`metadata`。
- 同一用户下 `key` 唯一。

### Project Memory

路径：`/api/v1/memory/project-memories`

- 保存用户在指定项目中的约定、决策和上下文。
- 主要字段：`project_id`、`key`、`content`、`metadata`。
- 同一用户、同一 `project_id` 下 `key` 唯一。

### Task History

路径：`/api/v1/memory/task-history`

- 保存任务输入、输出和执行状态，可关联 `project_id` 与 `session_id`。
- 同一用户下 `task_id` 唯一。
- 状态为 `pending/running/completed/failed/cancelled`。
- 进入终态且未传 `completed_at` 时自动记录当前时间；改回 `pending` 或 `running` 时自动清空 `completed_at`。

### 用户隔离是强制安全边界

- Memory 请求体和查询参数不得接受或透传 `user_id`。
- 服务端必须从 Bearer Token 获取当前用户，并自动写入数据归属。
- 列表只能返回当前用户的数据。
- 读取、修改或删除其他用户的数据统一返回 `404`，即使当前用户是管理员，也不得泄露目标记录是否存在。
- 不同用户可以使用相同的 Memory `key` 或 `task_id`。

## 通用接口行为

- 列表响应统一为：

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 20
}
```

- 支持 `page`、`page_size`，其中 `page_size` 最大为 100，并根据资源支持 `search`、`status`、`severity`、`asset_id`、`project_id`、`session_id` 等过滤条件。
- 空 PATCH 返回 `400`。
- 唯一字段冲突或关联约束冲突返回 `409`。
- 字段校验或关联 ID 无效返回 `422`。
- 资源不存在返回 `404`，权限不足返回 `403`。
- 写操作必须具备事务一致性，失败时不能留下部分更新。
- 时间字段使用带时区的 ISO 8601 格式。

## 测试要求

使用 `pytest` 和 FastAPI `TestClient` 编写回归测试，测试数据库必须使用临时 SQLite 文件，绝不能修改 `data/security.db`。至少覆盖：

1. 登录、无效 Token 和停用账号。
2. 三种 Security 角色的读写删权限。
3. `user_a` 无法提升权限。
4. 用户、资产、漏洞和事件 CRUD。
5. 资产与漏洞、事件的多对多关联。
6. 关闭时间的自动设置与重新打开时清空。
7. 所有统计接口及零值枚举补齐。
8. 三类 Memory 的 CRUD、唯一约束和筛选。
9. Memory 跨用户列表、详情、修改和删除隔离。
10. 请求体伪造 `user_id` 被拒绝。
11. OpenAPI 中包含全部公开接口。

执行：

```bash
cd mock-service-api
python3 -m pip install -r requirements-dev.txt
pytest -q
```

## 文档与验收

- README 必须说明安装、启动、环境变量、认证方式、接口清单、权限模型、Memory 隔离、错误码和测试命令。
- 提供可直接运行的登录和 Bearer Token 调用示例。
- `python3 run.py` 可以启动服务。
- `/health` 同时验证应用和数据库可用性。
- `/docs` 与 `/openapi.json` 可正常访问。
- `pytest -q` 全部通过。
- 运行 `git diff --check`，确保没有格式错误。
- 交付前确认未提交 `.env`、数据库、密钥、Token、`.venv/`、缓存或其他本地运行数据。

实现时先阅读当前目录的 README、配置、数据库模型、路由和测试，优先在现有架构上做最小修改。不要重写无关模块，不要伪造测试通过，也不要用内存数据掩盖 API 或数据库错误。

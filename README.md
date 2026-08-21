# DeepSeek Harness Security Plugins

本项目用于独立维护基于 DeepSeek Harness 框架开发的安全领域插件。插件代码与 Harness 主仓库解耦，便于单独开发、测试、构建和发布。

仓库目前包含资产管理和 Memory 两个插件，以及一套供本地开发和联调使用的模块化 API。资产管理插件提供资产查询、统计和风险评估；Memory 插件提供按用户隔离的 User Memory、Project Memory 和 Task History。

## 项目结构

```text
.
├── mock-service-api/                         # 本地联调用 FastAPI 服务
│   ├── app/                                  # Security 与 Memory 模块
│   └── tests/                                # API 自动化测试
└── security-harness-plugin/                  # pnpm 插件 workspace
    └── plugins/
        ├── asset-management/                 # 资产管理插件
        └── memory/                           # 用户隔离 Memory 插件
```

两个子项目可以分别开发。完整联调时，先启动 `mock-service-api`，再配置并启动 DeepSeek Harness 中的插件。

## 1. 启动本地 API 服务

要求 Python 3.11 或更高版本。

```bash
cd mock-service-api
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements.txt
python3 run.py
```

以上命令使用项目内置的本地开发配置。需要修改数据库路径、JWT 密钥或其他运行参数时，再参考 [`mock-service-api/README.md`](mock-service-api/README.md) 配置环境变量。

服务默认监听 `http://127.0.0.1:8000`：

- API 根地址：`http://127.0.0.1:8000/api/v1`
- Swagger 文档：`http://127.0.0.1:8000/docs`
- OpenAPI 定义：`http://127.0.0.1:8000/openapi.json`
- 健康检查：`http://127.0.0.1:8000/health`

首次启动默认创建以下联调账号：

| 用户名 | 密码 | Security 模块权限 |
| --- | --- | --- |
| `admin` | `Admin@123` | 读、写、删除 |
| `user_a` | `UserA@123` | 读、写，不可删除 |
| `user_b` | `UserB@123` | 只读 |

默认凭据仅供本地联调。部署前必须修改 `JWT_SECRET`、初始密码等配置，且不得将 `.env` 提交到仓库。

Memory 是用户个人数据，不沿用上表的 Security 写权限；三个已启用账号都可以维护自己的 Memory，但不能访问他人数据。

## 2. 直接调用 API

先登录获取响应中的 `access_token`：

```bash
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123"}'
```

将 Token 放入 Bearer 请求头后调用业务接口：

```bash
export ACCESS_TOKEN='<上一步返回的 access_token>'

curl 'http://127.0.0.1:8000/api/v1/assets?page=1&page_size=20' \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

curl 'http://127.0.0.1:8000/api/v1/statistics/assets/risk-overview' \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"

curl 'http://127.0.0.1:8000/api/v1/memory/user-memories?page=1&page_size=20' \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

完整的接口、字段和权限说明见 [`mock-service-api/README.md`](mock-service-api/README.md)。

## 3. 构建并接入 Harness 插件

要求 Node.js `^22.19.0` 或 `>=24.0.0`，以及 pnpm `11.22.0`。

```bash
cd security-harness-plugin
pnpm install
pnpm run check
pnpm run build
```

启动 DeepSeek Harness 前设置 API 地址和登录凭据：

```bash
export ASSET_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export ASSET_API_USERNAME='admin'
export ASSET_API_PASSWORD='Admin@123'
export ASSET_API_TIMEOUT_MS='15000'

# 每个 Memory 插件实例只绑定一个 API 用户
export MEMORY_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export MEMORY_API_USERNAME='user_a'
export MEMORY_API_PASSWORD='UserA@123'
export MEMORY_API_TIMEOUT_MS='15000'
```

将插件安装到目标 Harness profile：

```bash
pnpm dsh plugin --profile web add "$(pwd)/plugins/asset-management"
pnpm dsh plugin --profile web add "$(pwd)/plugins/memory"
```

随后按 DeepSeek Harness 的方式启动对应 profile。两个插件会分别登录 API 并注册工具。

### 资产管理

资产管理插件注册以下只读工具：

| 工具 | 用途 |
| --- | --- |
| `asset_list` | 查询和筛选资产列表 |
| `asset_get` | 查询资产详情及关联风险 |
| `asset_ownership_statistics` | 统计资产责任人覆盖情况 |
| `asset_risk_overview` | 查询整体资产风险概览 |
| `assess_asset_risk` | 对重点资产执行多维风险评估 |

接入后可以直接向 Harness 提问，例如“查询所有互联网暴露的关键资产”或“评估重点资产是否存在高风险”，Harness 会按需调用相应工具。

资产清单、状态、统计和风险结论必须以本轮接口结果为准。接口认证失败、返回非成功状态、网络不可达、超时或响应格式异常时，Harness 应明确告知用户接口错误，不得使用会话记忆或历史工具结果补齐实时业务数据。详细规则见 [`asset-management/README.md`](security-harness-plugin/plugins/asset-management/README.md)。

### Memory

Memory 插件提供三组工具：

| 类型 | 定义 | 工具前缀 |
| --- | --- | --- |
| User Memory | 当前用户跨项目生效的稳定偏好和明确事实 | `user_memory_*` |
| Project Memory | 当前用户在指定 `project_id` 下的项目约定、决策和上下文 | `project_memory_*` |
| Task History | 当前用户的任务执行历史，不代表当前事实或长期指令 | `task_history_*` |

每组都包含 list、get、create、update 和 delete 工具。工具不接受 `user_id`；API 根据 Bearer Token 确定当前用户，插件还会通过 `/auth/me` 和响应中的 `user_id` 校验数据归属。一个插件实例只能绑定一个 API 用户；多用户 Harness 必须按用户拆分 scoped 实例或 profile。

只有用户明确要求记住、更新、遗忘，或工作流明确要求记录任务历史时，才执行 Memory 写操作。接口返回非 `2xx`、认证重试失败、网络或超时错误、JSON 格式异常、用户归属不匹配时，Harness 必须说明本次记忆读写未完成，不能用模型记忆、会话上下文或旧工具结果伪造成功。

插件 workspace 说明见 [`security-harness-plugin/README.md`](security-harness-plugin/README.md)；详细配置、工具和异常处理见 [`memory/README.md`](security-harness-plugin/plugins/memory/README.md)。

## 验证

API 测试：

```bash
cd mock-service-api
python3 -m pip install -r requirements-dev.txt
pytest -q
```

插件类型检查与构建：

```bash
cd security-harness-plugin
pnpm run check
pnpm run build
pnpm run test
```

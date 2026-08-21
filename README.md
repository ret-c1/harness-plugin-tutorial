# DeepSeek Harness Security Plugins

本项目用于独立维护基于 DeepSeek Harness 框架开发的安全领域插件。插件代码与 Harness 主仓库解耦，便于单独开发、测试、构建和发布。

仓库目前包含资产管理插件，以及一套供本地开发和联调使用的网络安全管理 API。资产管理插件会登录该 API，并向 DeepSeek Harness 注册资产查询、统计和风险评估工具。

## 项目结构

```text
.
├── mock-service-api/                         # 本地联调用 FastAPI 服务
│   ├── app/                                  # 用户、资产、漏洞、事件和统计接口
│   └── tests/                                # API 自动化测试
└── security-harness-plugin/                  # pnpm 插件 workspace
    └── plugins/
        └── asset-management/                 # 资产管理插件
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

| 用户名 | 密码 | 权限 |
| --- | --- | --- |
| `admin` | `Admin@123` | 读、写、删除 |
| `user_a` | `UserA@123` | 读、写，不可删除 |
| `user_b` | `UserB@123` | 只读 |

默认凭据仅供本地联调。部署前必须修改 `JWT_SECRET`、初始密码等配置，且不得将 `.env` 提交到仓库。

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
```

将资产管理插件安装到目标 Harness profile：

```bash
pnpm dsh plugin --profile web add "$(pwd)/plugins/asset-management"
```

随后按 DeepSeek Harness 的方式启动对应 profile。插件会自动登录 API，并注册以下只读工具：

| 工具 | 用途 |
| --- | --- |
| `asset_list` | 查询和筛选资产列表 |
| `asset_get` | 查询资产详情及关联风险 |
| `asset_ownership_statistics` | 统计资产责任人覆盖情况 |
| `asset_risk_overview` | 查询整体资产风险概览 |
| `assess_asset_risk` | 对重点资产执行多维风险评估 |

接入后可以直接向 Harness 提问，例如“查询所有互联网暴露的关键资产”或“评估重点资产是否存在高风险”，Harness 会按需调用相应工具。

插件的配置项和开发方式见 [`security-harness-plugin/README.md`](security-harness-plugin/README.md) 与 [`asset-management/README.md`](security-harness-plugin/plugins/asset-management/README.md)。

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
```

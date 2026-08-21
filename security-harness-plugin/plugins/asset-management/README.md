# Asset Management

DeepSeek Harness 的只读资产管理插件。插件连接网络安全资产 API，注册资产查询、统计和重点资产风险评估工具。

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ASSET_API_BASE_URL` | 否 | `http://127.0.0.1:8000/api/v1` | 资产 API 根地址，必须使用 HTTP 或 HTTPS |
| `ASSET_API_USERNAME` | 是 | — | 登录用户名 |
| `ASSET_API_PASSWORD` | 是 | — | 登录密码 |
| `ASSET_API_TIMEOUT_MS` | 否 | `15000` | 每次工具调用的超时时间（毫秒） |

凭据只通过环境变量注入，不要写入仓库。

## 开发

从 workspace 根目录执行：

```sh
pnpm --filter @security-harness/asset-management run check
pnpm --filter @security-harness/asset-management run build
```

本地源码注册路径：

```text
/Users/fan/Documents/workspace/security-harness-plugin/plugins/asset-management/src/index.ts
```

也可以把本子包作为 bundle 安装到 Harness profile：

```sh
pnpm dsh plugin --profile web add /Users/fan/Documents/workspace/security-harness-plugin/plugins/asset-management
```

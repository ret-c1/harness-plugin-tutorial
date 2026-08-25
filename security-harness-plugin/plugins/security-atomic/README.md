# Security Atomic

用于测试 DeepSeek Harness Agent Loop 的只读安全数据插件。插件把资产、漏洞和安全事件拆成独立原子工具；每次业务工具调用只访问一个 API 接口、返回一种实体，不在插件内做跨实体聚合、统计或风险打分。

## 原子工具

| 工具 | 单次调用边界 | 关联查询方式 |
| --- | --- | --- |
| `security_asset_list` | 分页查询资产列表 | 从结果取得 `asset_id` |
| `security_asset_get` | 查询单项资产；移除 API 内嵌的漏洞和事件 | 关联风险需继续调用漏洞、事件工具 |
| `security_vulnerability_list` | 分页查询漏洞列表 | 传 `asset_id` 查询指定资产的漏洞 |
| `security_vulnerability_get` | 查询单项漏洞 | 根据返回的 `asset_ids` 继续查询资产 |
| `security_event_list` | 分页查询安全事件列表 | 传 `asset_id` 查询指定资产的事件 |
| `security_event_get` | 查询单项安全事件 | 根据返回的 `asset_ids` 继续查询资产 |

工具名使用 `security_` 前缀，因此可以与现有 `asset-management` 插件同时加载，不会覆盖其 `asset_list`、`asset_get` 等工具。为了得到纯粹的原子工具对照结果，建议 Agent Loop 测试时只启用本插件，避免模型选择现有的聚合工具 `asset_risk_overview` 或 `assess_asset_risk`。

登录 Token 会在插件实例内缓存；除首次登录和一次 `401` 重新认证外，每次工具执行只发起一次业务 API 请求。插件不缓存资产、漏洞或安全事件结果。

## 环境变量

| 变量 | 必需 | 回退值 | 说明 |
| --- | --- | --- | --- |
| `SECURITY_ATOMIC_API_BASE_URL` | 否 | `ASSET_API_BASE_URL`，再回退到 `http://127.0.0.1:8000/api/v1` | Security API 根地址，必须使用 HTTP 或 HTTPS |
| `SECURITY_ATOMIC_API_USERNAME` | 条件必需 | `ASSET_API_USERNAME` | 登录用户名；两者至少设置一个 |
| `SECURITY_ATOMIC_API_PASSWORD` | 条件必需 | `ASSET_API_PASSWORD` | 登录密码；两者至少设置一个 |
| `SECURITY_ATOMIC_API_TIMEOUT_MS` | 否 | `ASSET_API_TIMEOUT_MS`，再回退到 `15000` | 每次工具调用的超时时间（毫秒） |

单独部署本插件时使用 `SECURITY_ATOMIC_API_*`。与 `asset-management` 共用同一 API 账号时可以只设置现有 `ASSET_API_*`；专用变量存在时优先使用专用值。凭据只通过环境变量或 Cordis schema 注入，不要写入仓库。

## Agent Loop 测试建议

可用下面的问题观察模型是否正确规划跨实体调用、逐项查询和翻页：

1. “找出所有关键资产，并分别列出每项资产尚未响应的高危及以上漏洞和安全事件。”
   预期先调用 `security_asset_list`，再按每个资产 ID 调用 `security_vulnerability_list` 与 `security_event_list`。
2. “查询 CVE-2024-XXXX 对应漏洞，并给出所有受影响资产的当前详情。”
   预期先调用漏洞列表或详情工具，再根据 `asset_ids` 逐项调用 `security_asset_get`。
3. “完整统计所有未闭环严重事件涉及哪些资产。”
   预期检查分页 `total`，必要时继续翻页，再查询去重后的资产 ID；插件本身不会代替 Agent 聚合。

测试时重点观察：是否补齐分页、是否对每个关联 ID 继续调用、某一步失败后是否明确标记未验证范围，以及是否错误复用历史结果。

## 实时数据与失败规则

- 当前清单、详情、数量、状态和关联关系必须来自本轮成功的 API 返回。
- 空列表是有效结果，不得用会话记忆补齐。
- `401` 会清除 Token、重新登录并重试一次；其他非 `2xx`、网络、超时、无效 JSON 或响应结构异常都会作为工具失败返回。
- 多步 loop 只有部分调用成功时，只能使用成功部分，并明确说明哪些资产、漏洞或事件未验证。

## 开发与安装

从 workspace 根目录执行：

```sh
pnpm --filter @security-harness/security-atomic run check
pnpm --filter @security-harness/security-atomic run build
pnpm --filter @security-harness/security-atomic run test
```

将 bundle 安装到 Harness profile：

```sh
pnpm dsh plugin --profile web add "$(pwd)/plugins/security-atomic"
```

也可以在 DeepSeek Harness 的 `scratch-plugin/cordis.yml` 中指向本地源码：

```yaml
- insert:
    - id: security-atomic
      name: /absolute/path/to/security-harness-plugin/plugins/security-atomic/src/index.ts
      config:
        baseUrl: !!js process.env.SECURITY_ATOMIC_API_BASE_URL ?? process.env.ASSET_API_BASE_URL ?? 'http://127.0.0.1:8000/api/v1'
        username: !!js process.env.SECURITY_ATOMIC_API_USERNAME ?? process.env.ASSET_API_USERNAME
        password: !!js process.env.SECURITY_ATOMIC_API_PASSWORD ?? process.env.ASSET_API_PASSWORD
        timeoutMs: !!js Number(process.env.SECURITY_ATOMIC_API_TIMEOUT_MS ?? process.env.ASSET_API_TIMEOUT_MS ?? 15000)
```

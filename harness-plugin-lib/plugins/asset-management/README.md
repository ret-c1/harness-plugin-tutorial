# Asset Management

DeepSeek Harness 的只读资产管理插件。插件连接网络安全资产 API，注册资产查询、统计和重点资产风险评估工具。

## 教学定位

本插件对应根教程的“业务流”阶段。与 `security-atomic` 把每次 API 查询暴露为一个原子 Tool 不同，本插件把已经稳定的分页、并发查询、汇总和评分规则封装进 `assess_asset_risk`，用于比较“Agent 编排”与“确定性代码编排”的差异。

| Tool | 作用 | 类型 |
| --- | --- | --- |
| `asset_list` | 分页查询和筛选资产 | 原子查询 |
| `asset_get` | 查询资产详情及内嵌关联风险 | 原子查询 |
| `asset_ownership_statistics` | 查询责任人覆盖统计 | 服务端统计 |
| `asset_risk_overview` | 查询全部资产风险概览 | 服务端统计 |
| `assess_asset_risk` | 筛选重点资产、补齐关联风险并评分 | Workflow-style 业务流 |

`assess_asset_risk` 的确定性执行链为：

```text
critical/high 资产分页查询
  → 每项资产的 critical/high 漏洞与事件并发分页查询
  → 排除已闭环项并汇总未响应项
  → 叠加资产重要度、暴露面、责任人和风险项权重
  → 输出 risk_score、risk_level 与 reasons
```

这里的 Workflow-style Tool 只是插件内部业务编排，不代表独立的 Harness 工作流引擎。

## 环境变量

| 变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ASSET_API_BASE_URL` | 否 | `http://127.0.0.1:8000/api/v1` | 资产 API 根地址，必须使用 HTTP 或 HTTPS |
| `ASSET_API_USERNAME` | 是 | — | 登录用户名 |
| `ASSET_API_PASSWORD` | 是 | — | 登录密码 |
| `ASSET_API_TIMEOUT_MS` | 否 | `15000` | 每次工具调用的超时时间（毫秒） |

凭据只通过环境变量注入，不要写入仓库。

## Harness 挂载与测试

源码联调时，在 Harness 的 `scratch-plugin/cordis.yml` 中挂载：

```yaml
- insert:
    - id: asset-management
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/asset-management/src/index.ts'
      config:
        baseUrl: !!js process.env.ASSET_API_BASE_URL
        username: !!js process.env.ASSET_API_USERNAME
        password: !!js process.env.ASSET_API_PASSWORD
        timeoutMs: !!js Number(process.env.ASSET_API_TIMEOUT_MS)
```

重启 Harness，新建 Session 并输入：

```text
评估全部重点资产的当前风险，列出风险分、风险等级和主要原因。
```

预期 Agent 调用一次 `assess_asset_risk`，Tool 内部完成完整业务流。测试 Agent Loop 的多次原子调用时，应改为只挂载 `security-atomic`，避免模型选择本插件的聚合能力。

## 实时数据与记忆使用规则

插件会向 Harness 系统提示词注册资产数据真实性规则，并在每个工具描述和失败结果中重复关键约束。插件只缓存登录 Token，不缓存资产、漏洞、安全事件或统计结果。

| 场景 | 处理规则 |
| --- | --- |
| 当前资产清单、详情、数量、状态、责任人、漏洞、事件、统计和风险判断 | 必须调用接口，以本轮成功结果为唯一事实来源 |
| 用户在前文给出的资产 ID、名称和筛选条件 | 可以从会话记忆读取，用于组织本轮接口参数，但不能视为已经过接口验证的当前事实 |
| 资产管理、安全风险等通用概念 | 不依赖当前业务数据时可以使用模型知识回答 |
| 用户明确要求回顾先前查询结果 | 可以复述，但必须说明是历史结果，不代表当前状态 |
| 工具成功返回空列表 | 如实说明没有匹配数据，不得用记忆补齐 |
| 实时接口调用失败 | 告知用户接口失败及简要原因，不得使用记忆、历史工具结果或模型知识代替本次数据 |
| 多接口调用部分失败 | 只使用成功部分，并明确指出哪些部分未验证，不推断失败部分 |

后续问题只要要求当前状态、重新统计、比较最新变化或重新评估风险，就需要再次调用接口。

## 接口错误处理

HTTP `2xx` 且响应为有效 JSON 时才视为成功。其他情况按以下规则处理：

| 情况 | 插件行为 |
| --- | --- |
| 业务接口返回 `401` | 清除缓存 Token，重新登录并重试一次原请求；仍失败则报错 |
| 登录失败或 `403` | 明确报告认证失败或权限不足，不重试业务请求 |
| `400/404/409/422` | 保留 HTTP 状态和接口错误详情，直接报告参数、资源或数据问题 |
| `408/429/5xx` | 明确报告超时、限流或服务端异常，不返回历史数据 |
| 网络不可达、连接失败 | 报告无法连接资产服务，并提示检查服务状态、地址和网络 |
| 调用被取消或超时 | 报告请求已取消或超时，不返回不完整结果 |
| `2xx` 但响应为空、不是 JSON 或不符合插件要求 | 按接口响应格式错误处理，不将内容当作成功数据 |

所有工具错误都会作为 Harness 的失败结果返回。除参数错误可由 Harness 修正后重新调用外，涉及接口状态的错误必须呈现给用户。

## 开发

从 workspace 根目录执行：

```sh
pnpm --filter @security-harness/asset-management run check
pnpm --filter @security-harness/asset-management run build
pnpm --filter @security-harness/asset-management run test
```

在 workspace 根目录中，本地源码相对路径为：

```text
plugins/asset-management/src/index.ts
```

也可以把本子包作为 bundle 安装到 Harness profile：

```sh
pnpm dsh plugin --profile web add "$(pwd)/plugins/asset-management"
```

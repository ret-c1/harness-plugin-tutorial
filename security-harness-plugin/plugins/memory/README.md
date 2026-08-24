# Memory Plugin

为 DeepSeek Harness 提供基于 HTTP API 的用户隔离记忆能力。插件注册 User Memory、Project Memory 和 Task History 三组共 15 个 CRUD 工具，以及 2 个可观测召回工具；同时在 Harness Web 中提供逐轮 Memory Inspector。所有 API 调用都会验证当前身份和响应数据归属。

## 三类数据

| 类型 | 定义 | 适合保存 | 不应保存 |
| --- | --- | --- | --- |
| User Memory | 当前认证用户跨项目生效的稳定偏好和明确事实 | 回答语言、输出风格、用户明确要求长期记住的信息 | 单个项目约定、一次任务结果、密码和 Token |
| Project Memory | 当前认证用户在指定 `project_id` 下的项目约定、决策和上下文 | API 兼容约定、项目技术选型、目录规则 | 其他项目的数据、实时业务状态、短期任务流水 |
| Task History | 当前认证用户的任务执行历史 | 任务输入、输出、状态、起止时间和关联会话 | 当前仍然有效的事实、长期偏好、项目规则 |

Task History 只说明“曾经执行过什么”，不能直接证明项目当前仍处于相同状态。资产、漏洞、安全事件等实时数据也不能从 Memory 推断，必须调用对应业务接口。

## 用户隔离

一个插件实例只绑定配置中的一个 API 用户：

1. 插件使用配置的用户名和密码调用 `/auth/login`。
2. 登录后调用 `/auth/me`，确认接口返回的用户名与配置完全一致。
3. 工具参数不提供 `user_id`，发送请求时也只保留明确允许的字段。
4. API 根据 Bearer Token 确定用户；插件再次校验每条响应的 `user_id`。
5. 返回其他用户的数据、缺失 `user_id` 或身份不一致时，插件拒绝使用该响应。

管理员也不会获得跨用户 Memory 访问能力。共享 Harness 服务必须为每个终端用户配置独立的 scoped 插件实例或独立 profile，并分别绑定该用户的 API 账号。不要复用一个全局 Memory 实例服务多个用户，也不要让模型传入或推断用户 ID。

## 配置与安装

要求 Memory API 已启动，Base URL 指向 API 的 `/api/v1`：

```sh
export MEMORY_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export MEMORY_API_USERNAME='user_a'
export MEMORY_API_PASSWORD='UserA@123'
export MEMORY_API_TIMEOUT_MS='15000'
```

在 `security-harness-plugin/` 目录安装到目标 profile：

```sh
pnpm install
pnpm run build
pnpm dsh plugin --profile web add "$(pwd)/plugins/memory"
```

`cordis.patch.yml` 会读取以上环境变量。生产环境应通过部署系统注入凭据，不要写入仓库或提交 `.env`。

## 工具

Memory 的使用链路由两个只读工具显式完成：

| 工具 | 作用 | 是否算作“本轮已使用” |
| --- | --- | --- |
| `memory_recall` | 从三类 Memory 检索候选，并记录本轮查询目的 | 否；命中仅表示候选被召回 |
| `memory_context_apply` | 重新读取明确选中的候选，校验当前用户归属和最新内容，并说明使用原因、预期影响 | 是；只有成功返回的记录才算已使用 |

`memory_recall.query` 用于记录为什么发起本轮召回；`search` 才是传给 API 的精简关键词。省略 `search` 时，每个选中类别最多返回最近 `limit` 条记录。`memory_context_apply` 是只读操作，不会创建或修改 Memory。

| 类型 | 查询列表 | 查询详情 | 创建 | 修改 | 删除 |
| --- | --- | --- | --- | --- | --- |
| User Memory | `user_memory_list` | `user_memory_get` | `user_memory_create` | `user_memory_update` | `user_memory_delete` |
| Project Memory | `project_memory_list` | `project_memory_get` | `project_memory_create` | `project_memory_update` | `project_memory_delete` |
| Task History | `task_history_list` | `task_history_get` | `task_history_create` | `task_history_update` | `task_history_delete` |

列表工具支持分页和搜索；Project Memory 可按 `project_id` 过滤；Task History 可按 `project_id`、`session_id` 和 `status` 过滤。创建 Task History 时省略 `session_id`，插件会在可用时写入当前 Harness Agent/Session ID。

写入规则：

- 只有用户明确要求“记住、更新、遗忘”，或工作流明确要求维护任务历史时，才执行相应写操作。
- 删除必须有明确对象和意图，不能根据过期、冲突或不确定内容自行删除。
- 不保存密码、Token、密钥及其他敏感凭据。
- User Memory、Project Memory 和 Task History 不互相替代；需要哪一类上下文，就查询哪一类。

## Memory Inspector

安装插件的浏览器端模块后，Harness Web 会在发生 Memory 召回的会话轮次末尾显示三栏 Inspector：

```text
Memory Store          Recalled Memory        Agent Action
候选记忆快照           ✓ 本轮已应用             应用后的非 Memory Tool
                      × 候选但未应用           调用名称和参数
```

面板展示的是一条可审计链路：

```text
Memory Store → Search / Recall → Context Apply → Agent Action
```

- `Memory Store` 是本轮 `memory_recall` 返回的候选快照，并不是账号内所有记录。
- `Recalled Memory` 以 `memory_context_apply` 的成功结果作为“已使用”的唯一依据；候选未被选择时显示 `×`。
- `Agent Action` 记录成功应用 Memory 后发起的非 Memory 工具调用及其参数。它证明调用发生在应用之后，但不把时间顺序夸大为严格因果证明；`intended_effect` 会同时显示 Agent 声明的预期影响。
- 如果记录的 `metadata.source` 为 `explicit`、`agent` 或 `workflow`，以及 `metadata.status` 为 `active`、`expired` 或 `superseded`，面板会显示对应来源和状态。插件目前只展示这些可选字段，不会自动改写状态或创建历史版本。
- Inspector 数据来自已持久化的工具展示元数据；浏览器不会持有 Memory API 用户名、密码或 Token，也不会绕过当前用户隔离重新请求 API。

只用绝对 `src/index.ts` 路径可以加载插件的服务端工具，但 Harness 的 Web 客户端模块扫描依赖 npm 包名和 `package.json`。本地源码联调时，先构建插件并在目标 Harness profile 的 `node_modules` 中建立本地软链接，再在 `scratch-plugin/cordis.yml` 中使用包名。以下以默认 web profile 为例；`DSH_HOME` 未设置时通常是 `~/.dsh`：

```sh
cd /path/to/harness-plugin/security-harness-plugin
pnpm --filter @security-harness/memory run build

mkdir -p "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/@security-harness"
ln -sfn /path/to/harness-plugin/security-harness-plugin/plugins/memory \
  "${DSH_HOME:-$HOME/.dsh}/profiles/web/node_modules/@security-harness/memory"
```

```yaml
- id: memory
  name: '@security-harness/memory'
  config:
    baseUrl: !!js process.env.MEMORY_API_BASE_URL
    username: !!js process.env.MEMORY_API_USERNAME
    password: !!js process.env.MEMORY_API_PASSWORD
    timeoutMs: !!js Number(process.env.MEMORY_API_TIMEOUT_MS)
```

## 接口异常处理

插件只将格式正确的 `2xx` 响应视为成功；删除接口还必须返回空的 HTTP `204`。其他情况按失败处理：

| 情况 | 插件行为 | Harness 应向用户说明 |
| --- | --- | --- |
| `400/422` | 拒绝结果，不缓存为成功 | 请求或字段校验失败 |
| `401` | 清除 Token 并重新登录、重试一次；再次失败后停止 | 认证失败或登录已过期 |
| `403` | 不重试 | 当前绑定账号无权操作 |
| `404` | 不重试 | 记录不存在，或不属于当前用户 |
| `409` | 不重试 | 当前用户作用域内的唯一键冲突 |
| `408/429` | 不伪造结果 | 请求超时或请求过于频繁 |
| `5xx`、网络错误、超时 | 不使用旧响应补齐 | Memory 服务不可用或调用失败 |
| 成功状态但 JSON/归属异常 | 拒绝响应 | 接口响应格式或用户归属异常 |

任何读取失败都不能声称“已读取记忆”，任何写入失败都不能声称“已保存、修改或删除”。模型自身上下文、历史工具结果和 Task History 都不能用来伪造本次 Memory API 的成功结果。

## 开发与验证

```sh
pnpm --filter @security-harness/memory run check
pnpm --filter @security-harness/memory run build
pnpm --filter @security-harness/memory run test
```

API 路径、请求字段和状态枚举见 [`../../../mock-service-api/README.md`](../../../mock-service-api/README.md)。

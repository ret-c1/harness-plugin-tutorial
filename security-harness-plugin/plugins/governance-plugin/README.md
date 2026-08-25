# Governance Plugin

一个最小化的 DeepSeek Harness 工具治理示例。正式插件不注册资产业务工具，只在 `tools/pre-execute` 拦截已经存在的同名工具调用。目录另带一个需要显式源码挂载的无副作用教学测试桩，正式 bundle 不会自动启用它。

| Tool | Decision | 行为 |
| --- | --- | --- |
| `query_assets` | `allow` | 调用 `next()`，允许后续策略继续判断 |
| `assess_asset_risk` | `allow` | 调用 `next()`，允许后续策略继续判断 |
| `update_asset` | `ask` | 请求用户确认；确认后才执行 |
| `delete_asset` | `deny` | 直接拒绝，不执行工具 |

未列出的工具调用 `next()`，不会被该示例额外拦截。`allow` 同样通过 `next()` 委托，因此不会绕过其他治理插件的拒绝决定。

## 最小实现

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  switch (exec.name) {
    case 'query_assets':
    case 'assess_asset_risk':
      return next()
    case 'update_asset':
      return { kind: 'ask', reason: '治理策略：update_asset 会修改资产，需要用户确认。' }
    case 'delete_asset':
      return { kind: 'deny', reason: '治理策略：禁止调用 delete_asset。' }
    default:
      return next()
  }
})
```

`ask` 需要 Harness 挂载 approval service 和可用的 approval channel。缺少任一条件时，Harness 会安全地把该调用拒绝掉，而不是自动放行。

治理 hook 只会收到已经注册成功的工具调用；未知工具会在进入 `tools/pre-execute` 前被 Tool Runtime 拒绝。正式插件不会伪造资产业务能力，也不会与真实 `assess_asset_risk` 重复注册。

## 无副作用教学测试桩

`src/demo-tools.ts` 作为独立 Cordis 插件注册 `query_assets`、`assess_asset_risk`、`update_asset` 和 `delete_asset`。四个 Tool 都没有参数，只返回固定 JSON，不访问 API、不读取或修改业务数据。它仅用于观察 pre-execute 决策，未加入 `cordis.patch.yml`，因此安装正式 bundle 时不会启用。

## 安装

```sh
cd security-harness-plugin
pnpm dsh plugin --profile web add "$(pwd)/plugins/governance-plugin"
```

## Harness 教学验证

源码联调时，同时挂载测试桩和治理策略：

```yaml
- insert:
    - id: governance-demo-tools
      name: '/absolute/path/to/harness-plugin-tutorial/security-harness-plugin/plugins/governance-plugin/src/demo-tools.ts'

    - id: governance-plugin
      name: '/absolute/path/to/harness-plugin-tutorial/security-harness-plugin/plugins/governance-plugin/src/index.ts'
```

然后分别提问：

```text
只调用 query_assets，并返回工具的完整 JSON。
只调用 assess_asset_risk，并返回工具的完整 JSON。
只调用 update_asset，并返回工具的完整 JSON。
只调用 delete_asset，并返回工具的完整 JSON。
```

两个 allow Tool 会执行并返回 `side_effects: false`；update 出现确认，批准后才执行；delete 被拒绝且测试桩不执行。四个问题最好使用独立 Session，避免模型复用先前结果。完整步骤见仓库根目录 [`README.md`](../../../README.md) 的第 7 步。

## 验证

```sh
cd security-harness-plugin
pnpm --filter @security-harness/governance-plugin run check
pnpm --filter @security-harness/governance-plugin run build
pnpm --filter @security-harness/governance-plugin run test
```

测试覆盖四条指定规则，并验证未列出的工具会继续交给下游策略。

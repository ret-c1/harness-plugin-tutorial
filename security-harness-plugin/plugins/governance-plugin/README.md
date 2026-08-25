# Governance Plugin

一个最小化的 DeepSeek Harness 工具治理示例。插件不注册资产业务工具，只在 `tools/pre-execute` 拦截已经存在的同名工具调用。

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

治理 hook 只会收到已经注册成功的工具调用；未知工具会在进入 `tools/pre-execute` 前被 Tool Runtime 拒绝。因此测试四条规则时，需要同时挂载提供这些名称的工具插件或测试桩。本插件不会伪造 `query_assets`、`update_asset` 或 `delete_asset`，也不会与现有 `assess_asset_risk` 重复注册。

## 安装

```sh
cd security-harness-plugin
pnpm dsh plugin --profile web add "$(pwd)/plugins/governance-plugin"
```

## 验证

```sh
cd security-harness-plugin
pnpm --filter @security-harness/governance-plugin run check
pnpm --filter @security-harness/governance-plugin run build
pnpm --filter @security-harness/governance-plugin run test
```

测试覆盖四条指定规则，并验证未列出的工具会继续交给下游策略。

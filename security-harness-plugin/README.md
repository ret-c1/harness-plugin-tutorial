# Security Harness Plugins

独立于 DeepSeek Harness 源码维护的安全领域插件 workspace。DeepSeek Harness 是运行时，本仓库只维护业务插件；安全平台 API 继续作为独立业务服务。

## 结构

```text
security-harness-plugin/
├── plugins/
│   ├── asset-management/
│   │   ├── src/index.ts
│   │   ├── cordis.patch.yml
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── memory/
│   │   ├── src/index.ts                    # 服务端工具
│   │   ├── src/client/                     # Web Memory Inspector
│   │   ├── cordis.patch.yml
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── tsconfig.client.json
│   └── security-atomic/
│       ├── src/index.ts                    # 资产、漏洞、事件原子工具
│       ├── cordis.patch.yml
│       ├── package.json
│       └── tsconfig.json
├── package.json
├── pnpm-workspace.yaml
└── pnpm-lock.yaml
```

根目录只是 workspace，不导出 Cordis 插件，也不声明 `dsh.bundle`。每个 `plugins/<name>` 子目录都是一个具名插件包，可以独立构建、安装和演进。

## 命名约定

同一个插件在各层使用同一语义名称：

| 层 | 格式 | 资产管理插件 |
| --- | --- | --- |
| 目录 | `plugins/<name>` | `plugins/asset-management` |
| npm 包 | `@security-harness/<name>` | `@security-harness/asset-management` |
| Cordis `name` | `<name>` | `asset-management` |
| Loader row `id` | `<name>` | `asset-management` |

新增插件时复制一个子包骨架，而不是把实现继续堆进公共 `src/`。

## 当前插件

| 插件 | 用途 | 数据边界 |
| --- | --- | --- |
| [`asset-management`](plugins/asset-management/README.md) | 资产查询、统计与风险评估 | 只读，实时状态必须以本轮 API 为准 |
| [`memory`](plugins/memory/README.md) | User Memory、Project Memory、Task History 和逐轮 Memory Inspector | 可读写，一个实例只绑定一个 API 用户 |
| [`security-atomic`](plugins/security-atomic/README.md) | 资产、漏洞、事件原子查询和 Agent Loop 测试 | 只读，每个业务工具只访问一个接口并返回一种实体 |

## 开发

安装整个 workspace 的依赖并检查全部插件：

```sh
pnpm install
pnpm run check
pnpm run build
pnpm run test
```

只操作一个插件：

```sh
pnpm --filter @security-harness/asset-management run check
pnpm --filter @security-harness/asset-management run build
pnpm --filter @security-harness/asset-management run test

pnpm --filter @security-harness/memory run check
pnpm --filter @security-harness/memory run build
pnpm --filter @security-harness/memory run test

pnpm --filter @security-harness/security-atomic run check
pnpm --filter @security-harness/security-atomic run build
pnpm --filter @security-harness/security-atomic run test
```

DeepSeek Harness 源码仓库中的 `scratch-plugin/cordis.yml` 只保存本地开发所需的插件注册行。纯服务端插件可以指向 `plugins/<name>/src/index.ts`；声明了 `dsh.client` 的插件必须先构建、在目标 Harness profile 的 `node_modules` 中建立本地包软链接，再使用 npm 包名注册，否则 Loader 和 Harness Web 无法从 `package.json` 发现客户端 bundle。业务实现不进入 Harness 仓库。

生产或独立 profile 使用每个子包自己的 `dsh.bundle`：

```sh
pnpm dsh plugin --profile web add "$(pwd)/plugins/asset-management"
pnpm dsh plugin --profile web add "$(pwd)/plugins/security-atomic"
pnpm dsh plugin --profile web add "$(pwd)/plugins/memory"
```

安装 Memory 插件前必须先配置 `MEMORY_API_BASE_URL`、`MEMORY_API_USERNAME`、`MEMORY_API_PASSWORD` 和可选的 `MEMORY_API_TIMEOUT_MS`。共享多用户部署不得共用一组账号，应按用户拆分 scoped 插件实例或 profile。详细说明见 [`memory/README.md`](plugins/memory/README.md)。

安装 Security Atomic 插件前配置 `SECURITY_ATOMIC_API_USERNAME`、`SECURITY_ATOMIC_API_PASSWORD`，以及可选的 `SECURITY_ATOMIC_API_BASE_URL`、`SECURITY_ATOMIC_API_TIMEOUT_MS`；与资产管理插件共用账号时，未设置的专用变量会回退到对应的 `ASSET_API_*`。为避免聚合工具影响 Agent Loop 对照测试，建议对应 profile 只启用该插件。详细说明见 [`security-atomic/README.md`](plugins/security-atomic/README.md)。

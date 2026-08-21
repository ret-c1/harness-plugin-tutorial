# AGENTS.md

本文件适用于仓库根目录及全部子目录，用于约束在本项目中工作的自动化 Agent。

## 项目定位

- 本仓库独立维护基于 DeepSeek Harness 开发的安全领域插件，不修改或复制 Harness 核心代码。
- `security-harness-plugin/` 只负责插件 workspace；每个 `plugins/<name>/` 都应是可独立构建和安装的插件包。
- `mock-service-api/` 是插件开发、测试和演示所依赖的 API 服务。除非任务明确要求，不要把 API 业务逻辑写入插件。

## 工作规则

- 修改前先阅读目标目录的 README、配置和现有实现，保持已有架构、命名和代码风格。
- 只修改完成当前任务所需的文件，不覆盖用户已有改动，不提交生成目录或本地运行数据。
- 新插件沿用 `plugins/<name>`、`@security-harness/<name>`、Cordis `name` 和 Loader `id` 语义一致的命名规则。
- 插件配置通过 Cordis schema 或环境变量提供；不得硬编码凭据、Token、私有地址或机器专属绝对路径。
- API 变更应尽量保持已有路径、字段和枚举兼容。若必须破坏兼容性，应同步修改插件、测试和文档并明确说明。
- 面向用户的文档、工具描述和错误信息优先使用中文；代码标识符遵循现有英文命名。

## 安全约束

- 不提交 `.env`、数据库、密钥、Token、依赖目录、缓存或构建产物。
- 日志和错误信息不得输出密码或完整认证 Token。
- 插件默认保持最小权限。现有 `asset-management` 插件是只读插件，除非需求明确要求并说明风险，不新增写操作。
- `memory` 插件允许读写，但只能操作当前配置账号的 User Memory、Project Memory 和 Task History。工具不得接受或透传 `user_id`，共享服务必须按用户拆分插件实例或 profile。
- 只有用户明确要求记住、更新或遗忘，或工作流明确需要记录任务历史时，才调用 Memory 写工具；不得保存密码、Token 或密钥。
- API 认证失败、非 `2xx`、网络不可达、超时、响应格式异常或数据归属不匹配时，必须明确告知用户本次操作未完成；不得用模型记忆、会话上下文或历史工具结果伪造本次读写成功。
- 测试使用临时数据，不修改 `mock-service-api/data/security.db` 等本地正式数据。

## 验证要求

- 修改 Python API 后，在 `mock-service-api/` 运行 `pytest -q`。
- 修改 TypeScript 插件后，在 `security-harness-plugin/` 运行 `pnpm run check` 和 `pnpm run build`。
- 修改接口契约或插件配置时，同时验证 API 与插件，并更新相关 README、示例和 OpenAPI 描述。
- 仅修改文档时至少检查链接、命令、路径以及 `git diff --check`；无法执行验证时在交付说明中注明原因。

## 提交前检查

- 确认 `git diff` 中没有无关改动或敏感信息。
- 确认 `.venv/`、`node_modules/`、`lib/`、SQLite 数据库和缓存未进入暂存区。
- 简要说明改动内容、已执行的验证及尚存风险，不宣称未实际运行的测试已经通过。

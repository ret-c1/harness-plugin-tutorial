# harness-plugin-tutorial

这是一个由浅入深的 DeepSeek Harness 插件实践仓库。你会先准备一个可控的 Mock API 和可运行的 Harness，再依次学习原子 Tool、封装业务流、Memory、Sandbox 与 Governance。每一步只引入一个新概念，并通过固定问题观察 Agent 的工具选择、循环、权限边界和失败行为。

> 本仓库只维护教学插件和 Mock API，不修改或复制 DeepSeek Harness 核心代码。

## 学习路线

| 阶段 | 要解决的问题 | 使用内容 | 完成标志 |
| --- | --- | --- | --- |
| 1. Mock API | Agent 的实时业务数据从哪里来？ | `mock-service-api` | API、Swagger 和测试可用 |
| 2. Harness | 插件运行在哪里？ | DeepSeek Harness Web | 能创建 Session 并观察工具调用 |
| 3. 原子 Tool | 一个 Tool 的最小职责是什么？ | `security-atomic` | Agent 能用多个只读 Tool 完成 loop |
| 4. 业务流 | 何时把多步业务逻辑封装进一个 Tool？ | `asset-management` | 一次调用完成重点资产风险评估 |
| 5. Memory | 跨轮次信息如何被召回、应用和审计？ | `memory` | 新 Session 能显式召回记忆再查询实时数据 |
| 6. Sandbox | Tool 能执行与允许写到哪里有什么区别？ | `sandbox-test` | 看见三种模式的文件边界差异 |
| 7. Governance | Tool 执行前如何 allow、ask 或 deny？ | `governance-plugin` | 验证治理决策不会被业务 Tool 绕过 |

建议按顺序完成，不要第一次就同时挂载所有插件。一次只观察一个新增变量，实验结果会更容易解释。

## 项目结构

```text
.
├── mock-service-api/                         # FastAPI + SQLite 联调服务
│   ├── PROMPT.md                             # 从零实现 Mock API 的练习题
│   ├── app/                                  # Security 与 Memory 模块
│   ├── data/seed_test_data.sql               # 可重复导入的业务演示数据
│   └── tests/                                # API 回归测试
└── harness-plugin-lib/                        # pnpm 插件 workspace
    └── plugins/
        ├── security-atomic/                   # 阶段 3：原子只读 Tool
        ├── asset-management/                  # 阶段 4：业务流与风险评估
        ├── memory/                            # 阶段 5：用户隔离 Memory
        ├── sandbox-test/                      # 阶段 6：三种 Sandbox 边界
        └── governance-plugin/                 # 阶段 7：执行前治理
```

## 开始前准备

要求：

- Python 3.11 或更高版本。
- Node.js `^22.19.0` 或 `>=24.0.0`。
- pnpm `11.22.0`。
- 一份可以正常启动的 DeepSeek Harness 源码仓库。
- 可选的 `sqlite3` 命令行工具，用于快速导入演示数据。

以下命令约定两个路径变量。请替换成你机器上的真实绝对路径：

```sh
export TUTORIAL_ROOT='/absolute/path/to/harness-plugin-tutorial'
export HARNESS_ROOT='/absolute/path/to/deepseek-harness'
```

建议准备三个终端：

```text
终端 A：Mock API，端口 8000
终端 B：DeepSeek Harness Web，端口 3080
终端 C：配置、curl、测试和文件观察
```

首次使用先安装并验证插件 workspace：

```sh
cd "$TUTORIAL_ROOT/harness-plugin-lib"
pnpm install
pnpm run check
pnpm run build
pnpm run test
```

## 第 1 步：创建并启动 Mock API

### 学习目标

先把 Agent 依赖的外部系统固定下来。后续所有资产、漏洞、事件和 Memory 结果都来自这个 API，而不是模型记忆。

如果你想从零练习，先阅读 [`mock-service-api/PROMPT.md`](mock-service-api/PROMPT.md)，按提示实现服务，再用当前目录中的代码和测试作为参考答案。只想体验插件时，可以直接运行现有实现。

### 安装与测试

```sh
cd "$TUTORIAL_ROOT/mock-service-api"
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-dev.txt
pytest -q
```

测试使用临时 SQLite 文件，不会修改 `data/security.db`。

### 初始化演示数据

应用启动时会自动建表并创建三个本地联调账号，但不会自动导入资产、漏洞和安全事件。需要完整业务场景时执行：

```sh
cd "$TUTORIAL_ROOT/mock-service-api"
python3 -c 'from app.database import init_db; init_db()'
sqlite3 data/security.db ".read data/seed_test_data.sql"
```

种子 SQL 使用固定编号和 `INSERT OR IGNORE`，可重复执行。`data/security.db` 是被 Git 忽略的本地运行数据，不要提交。

### 启动和验收

在终端 A 启动：

```sh
cd "$TUTORIAL_ROOT/mock-service-api"
source .venv/bin/activate
python3 run.py
```

在终端 C 验证：

```sh
curl http://127.0.0.1:8000/health

curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"user_b","password":"UserB@123"}'
```

预期：

- `/health` 返回应用和数据库均为 `ok`。
- 登录响应包含 `access_token`，但不包含密码或密码哈希。
- `http://127.0.0.1:8000/docs` 可以浏览和调用全部接口。
- Swagger 中查询 `/api/v1/assets` 时能看到 `ASSET-001` 等演示数据。

默认账号只用于本机联调：`admin` 可读写删除，`user_a` 可读写但不可删除，`user_b` 只读。完整接口和权限见 [`mock-service-api/README.md`](mock-service-api/README.md)。

## 第 2 步：启动一个不带教学插件的 Harness

### 学习目标

先确认 Harness 自身可以工作，并建立后续实验共同的启动方式。此时不加载本仓库插件，避免把运行时问题误判成插件问题。

在 DeepSeek Harness 仓库的 `scratch-plugin/cordis.yml` 中准备一个空 patch：

```yaml
[]
```

如果该文件已经包含你的其他配置，请保留它们；后续只增删本教程对应的 Loader 条目。

在终端 B 启动：

```sh
cd "$HARNESS_ROOT"
pnpm install
pnpm dsh web --patch ./scratch-plugin/cordis.yml --port 3080
```

打开 `http://127.0.0.1:3080`，创建一个 Session，并确认可以正常完成不依赖业务 Tool 的对话。后续每次修改 `cordis.yml`、环境变量或服务端插件源码，都停止并重新运行这条命令。

### 每个插件阶段的固定动作

后面五个插件实验都遵循同一闭环：

```text
阅读插件 README
  → 只设置该阶段配置
  → 在 cordis.yml 挂载插件
  → 重启 Harness
  → 新建 Session
  → 输入固定测试问题
  → 查看 Tool Call、参数、结果和最终回答
```

源码挂载使用绝对路径。下面 YAML 中的 `/absolute/path/to/harness-plugin-tutorial` 必须替换为 `TUTORIAL_ROOT` 的真实值；YAML 不会自动展开 shell 变量。

## 第 3 步：设计最小职责的原子 Tool

### 学习目标

Tool 只做一件可验证的事：接收结构化参数、访问一个接口、返回一种实体。跨资产、漏洞和事件的推理交给 Agent Loop，而不是偷偷在 Tool 内聚合。

[`security-atomic`](harness-plugin-lib/plugins/security-atomic/README.md) 提供六个只读 Tool：资产、漏洞和事件分别有 list/get。可以先阅读 `security_asset_list` 的定义，再用同一结构理解其余五个。

### 配置和挂载

在启动 Harness 的终端设置只读账号：

```sh
export SECURITY_ATOMIC_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export SECURITY_ATOMIC_API_USERNAME='user_b'
export SECURITY_ATOMIC_API_PASSWORD='UserB@123'
export SECURITY_ATOMIC_API_TIMEOUT_MS='15000'
```

本阶段的 `scratch-plugin/cordis.yml` 只挂载 Security Atomic：

```yaml
- insert:
    - id: security-atomic
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/security-atomic/src/index.ts'
      config:
        baseUrl: !!js process.env.SECURITY_ATOMIC_API_BASE_URL
        username: !!js process.env.SECURITY_ATOMIC_API_USERNAME
        password: !!js process.env.SECURITY_ATOMIC_API_PASSWORD
        timeoutMs: !!js Number(process.env.SECURITY_ATOMIC_API_TIMEOUT_MS)
```

重启 Harness 后新建 Session。

### 测试 1：单实体查询

```text
查询资产编码 ASSET-001 的当前基本详情，不要查询漏洞或安全事件。
```

预期 Agent 只选择资产 list/get Tool，不应调用漏洞、事件或聚合工具。

### 测试 2：观察 Agent Loop

```text
找出所有 critical 资产，并分别列出每项资产尚未闭环的 high/critical 漏洞和安全事件。检查分页，某一步失败时明确未验证范围。
```

重点观察：

- 是否先调用 `security_asset_list` 取得资产 ID。
- 是否按每个资产 ID 继续调用漏洞和事件 Tool。
- 是否检查分页，而不是默认第一页就是全部数据。
- API 失败时是否停止补猜，并说明缺失范围。

这个阶段展示的是“Agent 编排多个原子能力”。插件不会替 Agent 做跨实体聚合。

## 第 4 步：把稳定业务流封装成 Workflow-style Tool

### 学习目标

当筛选条件、分页、并发查询和评分规则已经稳定，可以把它们封装为一个业务流 Tool。这里的 Workflow-style Tool 指插件内部的确定性业务编排，不是另一个独立的 Harness 工作流引擎。

[`asset-management`](harness-plugin-lib/plugins/asset-management/README.md) 中的 `assess_asset_risk` 会：

```text
筛选 critical/high 资产
  → 对每项资产查询 critical/high 漏洞和事件
  → 汇总未闭环与未响应项
  → 结合重要度、暴露面和责任人计算风险分
  → 返回逐资产结论和原因
```

### 配置和挂载

```sh
export ASSET_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export ASSET_API_USERNAME='user_b'
export ASSET_API_PASSWORD='UserB@123'
export ASSET_API_TIMEOUT_MS='15000'
```

将 `scratch-plugin/cordis.yml` 中阶段 3 的条目替换为：

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

重启 Harness 并新建 Session。

### 测试业务流

```text
评估全部重点资产的当前风险，列出风险分、风险等级和主要原因。
```

预期 Agent 选择一次 `assess_asset_risk`，由 Tool 内部完成分页、并发查询和评分。把结果与阶段 3 的多次 Tool Call 对比：

| 对比项 | 原子 Tool | Workflow-style Tool |
| --- | --- | --- |
| 编排者 | Agent | 插件中的确定性代码 |
| Tool Call 数量 | 多次 | 通常一次 |
| 规则位置 | Prompt/Agent 推理 | 版本化的业务代码 |
| 灵活性 | 高 | 固定业务场景更稳定 |
| 可审计重点 | Agent 调用链 | 业务规则和汇总结果 |

不要把所有问题都封装成大 Tool：只有重复、稳定、可测试的业务流才适合下沉。

## 第 5 步：设计练习版 Memory 场景

### 学习目标

区分“候选被召回”“本轮实际应用”和“应用后执行了什么”。Memory 只保存用户明确要求保留的偏好、项目约定和任务历史，不能替代资产 API 的实时结果。

### 配置和挂载

```sh
export MEMORY_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export MEMORY_API_USERNAME='user_a'
export MEMORY_API_PASSWORD='UserA@123'
export MEMORY_API_TIMEOUT_MS='15000'

export SECURITY_ATOMIC_API_BASE_URL='http://127.0.0.1:8000/api/v1'
export SECURITY_ATOMIC_API_USERNAME='user_b'
export SECURITY_ATOMIC_API_PASSWORD='UserB@123'
export SECURITY_ATOMIC_API_TIMEOUT_MS='15000'
```

基础练习只需要服务端 Tool，可在 `scratch-plugin/cordis.yml` 同时挂载 Memory 和 Security Atomic：

```yaml
- insert:
    - id: memory
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/memory/src/index.ts'
      config:
        baseUrl: !!js process.env.MEMORY_API_BASE_URL
        username: !!js process.env.MEMORY_API_USERNAME
        password: !!js process.env.MEMORY_API_PASSWORD
        timeoutMs: !!js Number(process.env.MEMORY_API_TIMEOUT_MS)

    - id: security-atomic
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/security-atomic/src/index.ts'
      config:
        baseUrl: !!js process.env.SECURITY_ATOMIC_API_BASE_URL
        username: !!js process.env.SECURITY_ATOMIC_API_USERNAME
        password: !!js process.env.SECURITY_ATOMIC_API_PASSWORD
        timeoutMs: !!js Number(process.env.SECURITY_ATOMIC_API_TIMEOUT_MS)
```

只用绝对源码路径不会加载 Memory Inspector 浏览器面板。需要完整三栏可视化时，按 [`memory/README.md`](harness-plugin-lib/plugins/memory/README.md) 构建并以 npm 包名挂载。

### 练习 1：明确写入项目记忆

```text
请记住一条 Project Memory：project_id 是 harness-plugin-tutorial，key 是 default_demo_asset，内容是“默认演示资产为 ASSET-001”。保存后告诉我接口是否成功。
```

预期调用 `project_memory_create`。没有成功的 API 返回，就不能声称已经记住。

### 练习 2：在新 Session 中召回、应用、行动

```text
先召回并应用 harness-plugin-tutorial 的默认演示资产约定，再查询该资产的当前详情。Memory 只用于确定查询对象，当前资产状态必须重新调用 Security Tool。
```

预期链路：

```text
memory_recall
  → memory_context_apply
  → security_asset_list / security_asset_get
  → 基于本轮 API 返回回答
```

这一步最重要的判断是：Memory 可以提供 `ASSET-001` 这个查询线索，但不能证明资产当前仍然存在或状态未变化。

### 练习 3：明确遗忘

```text
删除刚才 key 为 default_demo_asset 的 Project Memory，并明确告诉我删除是否成功。
```

预期先定位当前用户和项目下的记录，再调用 `project_memory_delete`。Memory 工具不接受 `user_id`，管理员也不能读取其他用户的 Memory。

## 第 6 步：用三个场景感受 Sandbox

### 学习目标

Tool 具备写文件能力，不代表它可以写任意位置。这个实验对比“不可写”“只能写 workspace”“workspace 边界消失”。

[`sandbox-test`](harness-plugin-lib/plugins/sandbox-test/README.md) 只有一个无参数 Tool `sandbox_write_test`，固定尝试写两个文件：

```text
.sandbox-demo/
├── project/                         ← Session workspace
│   └── sandbox-inside.txt
└── outside/                         ← workspace 外，但仍在本仓库实验区内
    └── sandbox-outside.txt
```

### 准备受控实验区

```sh
mkdir -p \
  "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo/project" \
  "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo/outside"

printf '%s\n' 'sandbox-test-demo-v1' \
  > "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo/.sandbox-demo-root"

git -C "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo/project" init

export SANDBOX_DEMO_ROOT="$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo"
export SANDBOX_TEST_TIMEOUT_MS='5000'
```

该目录在当前仓库内且已被 Git 忽略。Tool 没有路径、命令或内容参数，不会访问这个实验区以外的位置。

### 挂载

```yaml
- insert:
    - id: sandbox-test
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/sandbox-test/src/index.ts'
      config:
        demoRoot: !!js process.env.SANDBOX_DEMO_ROOT
        timeoutMs: !!js Number(process.env.SANDBOX_TEST_TIMEOUT_MS)
```

重启 Harness。三个场景必须使用三个新 Session，Session workspace 都选择：

```text
/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/.sandbox-demo/project
```

每次测试前只删除两个固定结果文件：

```sh
cd "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo"
rm -f -- ./project/sandbox-inside.txt ./outside/sandbox-outside.txt
```

三个 Session 使用完全相同的提示词：

```text
只调用 sandbox_write_test，返回完整 JSON。不要调用 Bash、Shell、文件工具或其他工具；失败时不要绕过。
```

| Session Sandbox mode | workspace 内 | workspace 外 | 预期文件 |
| --- | ---: | ---: | --- |
| `read-only` | ❌ | ❌ | 两个都不存在 |
| `workspace-write` | ✅ | ❌ | 只有 `project/sandbox-inside.txt` |
| `danger-full-access` | ✅ | ✅ | 两个都存在 |

测试后在终端 C 肉眼检查：

```sh
cd "$TUTORIAL_ROOT/harness-plugin-lib/.sandbox-demo"
ls -l ./project/sandbox-inside.txt ./outside/sandbox-outside.txt 2>/dev/null
```

`danger-full-access` 下操作系统 Sandbox 不再保护 workspace 边界。本实验之所以仍受控，是因为 Tool 固定路径且不接受输入。测试时不要同时向 Agent 暴露 Bash 或其他通用文件工具，也不要把 `SANDBOX_DEMO_ROOT` 指向仓库外目录。

## 第 7 步：设计插件治理场景

### 学习目标

Governance 不负责实现业务 Tool，而是在已注册 Tool 真正执行前做决策：

| Tool | 决策 | 预期行为 |
| --- | --- | --- |
| `query_assets` | allow | 交给后续策略，最终允许时执行 |
| `assess_asset_risk` | allow | 交给后续策略，最终允许时执行 |
| `update_asset` | ask | 用户确认后才执行 |
| `delete_asset` | deny | 不执行 Tool |

[`governance-plugin`](harness-plugin-lib/plugins/governance-plugin/README.md) 监听 `tools/pre-execute`。allow 使用 `next()`，因此不会绕过其他治理插件的拒绝策略。

### 挂载无副作用测试桩和治理插件

为了在 Web 中完整观察四条策略，同时保证不修改 Mock API，本阶段使用 `governance-plugin/src/demo-tools.ts`。这个可选测试桩只注册四个同名无参数 Tool，每个 Tool 都只返回固定 JSON，不访问 API、不读取或修改业务数据；正式 Governance bundle 不会自动挂载它。

本阶段的 `scratch-plugin/cordis.yml` 为：

```yaml
- insert:
    - id: governance-demo-tools
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/governance-plugin/src/demo-tools.ts'

    - id: governance-plugin
      name: '/absolute/path/to/harness-plugin-tutorial/harness-plugin-lib/plugins/governance-plugin/src/index.ts'
```

重启 Harness，分别新建 Session，并按顺序测试：

| 提示词 | 预期现象 |
| --- | --- |
| `只调用 query_assets，并返回工具的完整 JSON。` | allow；测试桩返回 `executed: true` |
| `只调用 assess_asset_risk，并返回工具的完整 JSON。` | allow；测试桩返回 `executed: true` |
| `只调用 update_asset，并返回工具的完整 JSON。` | ask；出现确认，批准后才返回 `executed: true` |
| `只调用 delete_asset，并返回工具的完整 JSON。` | deny；调用被拒绝，测试桩不会执行 |

`ask` 要求 Harness 已挂载 approval service 和可用 approval channel；缺少任一条件时会安全拒绝，而不是自动放行。治理 hook 只处理已注册 Tool，这也是为什么本阶段需要单独的无副作用测试桩。

自动化验证策略和测试桩：

```sh
cd "$TUTORIAL_ROOT/harness-plugin-lib"
pnpm --filter @security-harness/governance-plugin run test
```

预期策略测试和测试桩测试全部通过：两个 allow 会调用下游策略，update 返回 ask，delete 返回 deny，未列出 Tool 继续交给下游；测试桩四个 Tool 的直接执行结果都声明 `side_effects: false`。

这一阶段要记住三个边界：

```text
Tool 决定“能做什么”
Agent 决定“想调用什么”
Governance 决定“这次是否允许执行”
```

## 完整回归验证

修改 API 后：

```sh
cd "$TUTORIAL_ROOT/mock-service-api"
source .venv/bin/activate
pytest -q
```

修改 TypeScript 插件或插件文档后：

```sh
cd "$TUTORIAL_ROOT/harness-plugin-lib"
pnpm run check
pnpm run build
pnpm run test
```

只修改文档时至少执行：

```sh
cd "$TUTORIAL_ROOT"
git diff --check
```

## 下一步可以继续练习什么

- 给原子 Tool 增加一个新过滤参数，并同步 API、Schema、测试和文档。
- 对比同一问题在原子 Tool 与业务流 Tool 下的调用次数、延迟和失败面。
- 给 Memory 增加过期或 superseded 状态，但仍保持显式应用和用户隔离。
- 给 Governance 增加基于参数、用户或环境的组合策略，并验证下游策略仍能生效。
- 将本地源码挂载改为 bundle 安装，练习插件发布和 profile 生命周期。

插件 workspace 的构建、命名和安装说明见 [`harness-plugin-lib/README.md`](harness-plugin-lib/README.md)。每个实验的边界条件和排错细节，以对应插件 README 为准。

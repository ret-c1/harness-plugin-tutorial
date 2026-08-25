# Sandbox Test

DeepSeek Harness 的可视化 Sandbox 边界教学插件。插件只注册一个无参数工具 `sandbox_write_test`，在当前 Session 的 Sandbox mode 下固定尝试两个动作：

```text
受控 Demo 根目录
├── project/                         ← Session Git workspace
│   └── sandbox-inside.txt           ← 动作 A
└── outside/                         ← workspace 外、仍在 Demo 根目录内
    └── sandbox-outside.txt          ← 动作 B
```

| Sandbox mode | A：写 workspace 内 | B：写 workspace 外 | 肉眼看到的文件 |
| --- | ---: | ---: | --- |
| `read-only` | ❌ | ❌ | 两个文件都不存在 |
| `workspace-write` | ✅ | ❌ | 只有 `project/sandbox-inside.txt` |
| `danger-full-access` | ✅ | ✅ | 两个文件都存在 |

工具不会自动删除成功写入的文件，因此三种模式的边界差异可以直接通过 `ls` 和 `cat` 观察。

## 为什么不用 `/tmp/sandbox-demo`

Harness 的 `workspace-write` 策略可能同时允许部分系统临时目录写入。如果 Demo 的 `outside/` 也位于 `/tmp`，第二刀可能被临时目录白名单允许，无法稳定展示 workspace 边界。

本仓库建议把整个 Demo 放到 `security-harness-plugin/.sandbox-demo/`。这样 `outside/` 虽然在 Session workspace 外，仍受限于当前仓库中的专用实验区，不会触碰电脑其他数据目录。该目录已加入 `.gitignore`。

## 安全边界

- 工具没有参数，Agent 不能传入路径、命令或内容。
- `demoRoot` 必须是绝对路径，不能是文件系统根目录，并且必须包含内容固定的 `.sandbox-demo-root` 安全标记。
- Session cwd 必须精确等于 `demoRoot/project`；Sandbox policy 的 `workspaceRoot` 也必须匹配该目录。
- `project/`、`outside/` 和 `.git` 都不能是符号链接；两个目标只能是各自目录的直接子文件。
- Shell 脚本只包含固定的 `./sandbox-inside.txt` 和 `../outside/sandbox-outside.txt`，不使用网络。
- 使用 Shell `noclobber`，两个目标只要已有任意文件、目录或符号链接，工具就会在启动 Shell 前拒绝执行。
- 工具不做自动删除或递归清理。测试者只需删除两个名称固定的 Demo 文件。
- `danger-full-access` 时系统 Sandbox 不再提供边界保证；安全性来自工具固定无参数、固定路径以及专用 Demo 根目录。不要同时让 Agent 调用 Bash 或其他文件工具。

## 配置

| 字段 / 环境变量 | 必需 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `demoRoot` / `SANDBOX_DEMO_ROOT` | 是 | 无 | 受控 Demo 根目录的绝对路径 |
| `timeoutMs` / `SANDBOX_TEST_TIMEOUT_MS` | 否 | `5000` | 固定两次写入尝试的最长运行时间，单位毫秒 |

Bundle patch 使用以下配置：

```yaml
- insert:
    - id: sandbox-test
      name: '@security-harness/sandbox-test'
      config:
        demoRoot: !!js process.env.SANDBOX_DEMO_ROOT
        timeoutMs: !!js Number(process.env.SANDBOX_TEST_TIMEOUT_MS ?? 5000)
```

## 准备安全 Demo 目录

这些命令只在当前仓库被忽略的 `.sandbox-demo/` 中创建实验目录：

```sh
mkdir -p \
  /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo/project \
  /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo/outside

printf '%s\n' 'sandbox-test-demo-v1' \
  > /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo/.sandbox-demo-root

git -C /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo/project init
```

设置插件配置：

```sh
export SANDBOX_DEMO_ROOT='/path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo'
export SANDBOX_TEST_TIMEOUT_MS='5000'
```

## 源码挂载

```yaml
- insert:
    - id: sandbox-test
      name: /absolute/path/to/security-harness-plugin/plugins/sandbox-test/src/index.ts
      config:
        demoRoot: !!js process.env.SANDBOX_DEMO_ROOT
        timeoutMs: !!js Number(process.env.SANDBOX_TEST_TIMEOUT_MS ?? 5000)
```

也可以安装 bundle：

```sh
cd security-harness-plugin
pnpm dsh plugin --profile web add "$(pwd)/plugins/sandbox-test"
```

## 三刀测试方法

启动 Harness：

```sh
cd /Users/fan/Documents/workspace/deepseek-ai/deepseek-harness
pnpm dsh web --patch ./scratch-plugin/cordis.yml --port 3080
```

Session workspace 必须设置为：

```text
/path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo/project
```

每一刀都使用独立 Session，并在调用前把该 Session 的 Sandbox mode 设置为对应值。调用提示词保持一致：

```text
只调用 sandbox_write_test，返回完整 JSON。
不要调用 Bash、Shell、文件工具或其他工具；失败时不要绕过。
```

### 第一刀：read-only

1. 删除上次生成的两个确切文件，首次运行也可执行：

   ```sh
   cd /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo
   rm -f -- ./project/sandbox-inside.txt ./outside/sandbox-outside.txt
   ```

2. 新建 Session，选择 `read-only`，调用工具。
3. 预期 `passed: true`、`inside_written: false`、`outside_written: false`，两个文件都不存在。

### 第二刀：workspace-write

1. 再次执行上面的精确 reset 命令。
2. 新建 Session，选择 `workspace-write`，调用工具。
3. 预期 `passed: true`、`inside_written: true`、`outside_written: false`。

### 第三刀：danger-full-access

1. 再次执行上面的精确 reset 命令。
2. 新建 Session，选择 `danger-full-access`，调用工具。
3. 预期 `passed: true`、`inside_written: true`、`outside_written: true`。

## 肉眼检查

每次调用后执行：

```sh
cd /path/to/harness-plugin-tutorial/security-harness-plugin/.sandbox-demo

ls -l ./project/sandbox-inside.txt ./outside/sandbox-outside.txt 2>/dev/null

test ! -f ./project/sandbox-inside.txt || sed -n '1p' ./project/sandbox-inside.txt
test ! -f ./outside/sandbox-outside.txt || sed -n '1p' ./outside/sandbox-outside.txt
```

成功写入的文件内容固定为：

```text
created by sandbox_write_test
```

任一结果与预期不符时停止测试，保留工具 JSON 和两个 Demo 文件状态排查。不要扩大路径范围验证，也不要让 Agent 使用其他工具重试。

## 开发验证

自动化测试的临时数据只创建在插件目录下，并在测试结束后删除：

```sh
cd security-harness-plugin
pnpm --filter @security-harness/sandbox-test run check
pnpm --filter @security-harness/sandbox-test run build
pnpm --filter @security-harness/sandbox-test run test
```

自动化用例验证三种预期矩阵和防逃逸逻辑；真实操作系统 Sandbox 的边界仍需按上述三刀方法在 Harness 中验证。

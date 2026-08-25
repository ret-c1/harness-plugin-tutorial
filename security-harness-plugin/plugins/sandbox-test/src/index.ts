/**
 * A visible, bounded demonstration of the three DeepSeek Harness filesystem sandbox modes.
 * @module sandbox-test
 */

import type { Stats } from 'node:fs'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SandboxMode } from '@deepseek-ai/dsh-sandbox'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool, type JsonValue, type ToolExecution } from '@deepseek-ai/dsh-tools'

const DEMO_MARKER = '.sandbox-demo-root'
const DEMO_MARKER_CONTENT = 'sandbox-test-demo-v1\n'
const INSIDE_FILE = 'sandbox-inside.txt'
const OUTSIDE_FILE = 'sandbox-outside.txt'
const WRITTEN_TEXT = 'created by sandbox_write_test'
const WRITTEN_CONTENT = `${WRITTEN_TEXT}\n`

const SANDBOX_TEST_RULES = `## Sandbox 边界教学规则

- 仅当用户明确要求运行 Sandbox Demo 时调用 sandbox_write_test，不要在普通任务中自动运行。
- 工具不接受路径、命令或内容参数，只能写入受控 Demo 根目录中的 project/sandbox-inside.txt 和 outside/sandbox-outside.txt。
- outside 位于 Session workspace 外，但仍在专用 Demo 根目录内；工具不会访问 Demo 根目录之外的数据路径。
- 工具故意保留成功写入的文件供用户观察。目标文件已存在时会拒绝执行，绝不覆盖；每次切换模式前由用户按文档删除这两个确切文件。
- 工具失败时如实报告，不得换用 Bash、文件工具或其他方式绕过边界。`

interface ExpectedOutcome {
  insideWritten: boolean
  outsideWritten: boolean
  sandboxDenied: boolean
}

const EXPECTED: Record<SandboxMode, ExpectedOutcome> = {
  'read-only': {
    insideWritten: false,
    outsideWritten: false,
    sandboxDenied: true,
  },
  'workspace-write': {
    insideWritten: true,
    outsideWritten: false,
    sandboxDenied: true,
  },
  'danger-full-access': {
    insideWritten: true,
    outsideWritten: true,
    sandboxDenied: false,
  },
}

/** Cordis plugin name. */
export const name = 'sandbox-test'

/** Services required before the plugin registers its tool. */
export const inject = ['tools', 'shell', 'sandboxPolicy', 'systemPrompt']

/** Sandbox Demo settings. */
export interface Config {
  /** Absolute root containing the marker plus project/ and outside/ directories. */
  demoRoot: string
  /** Maximum duration of the fixed two-write demonstration. */
  timeoutMs: number
}

/** Sandbox-test plugin configuration schema. */
export const Config: z<Config> = z.object({
  demoRoot: z.string().required(),
  timeoutMs: z.number().step(1).min(1).default(5_000),
})

interface DemoLayout {
  demoRoot: string
  projectRoot: string
  outsideRoot: string
  insidePath: string
  outsidePath: string
}

interface TargetState {
  exists: boolean
  contentVerified: boolean
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function optionalLstat(path: string): Promise<Stats | undefined> {
  try {
    return await lstat(path)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function assertDirectChild(parent: string, childPath: string, expectedName: string): void {
  const child = relative(parent, childPath)
  if (
    child !== expectedName
    || isAbsolute(child)
    || child.startsWith(`..${sep}`)
    || child.includes(sep)
  ) {
    throw new Error('sandbox-test: a Demo path escaped its expected parent directory')
  }
}

async function directDirectory(parent: string, name: string): Promise<string> {
  const path = join(parent, name)
  assertDirectChild(parent, path, name)
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error(`sandbox-test: ${name}/ must be a direct, non-symlink directory`)
  }
  const canonical = await realpath(path)
  if (canonical !== path) {
    throw new Error(`sandbox-test: ${name}/ must not resolve outside the configured Demo root`)
  }
  return canonical
}

async function resolveLayout(config: Config, exec: ToolExecution): Promise<DemoLayout> {
  const cwd = exec.agent?.session.header.cwd
  if (cwd === undefined) {
    throw new Error('sandbox-test: an Agent Session with an explicit Demo project cwd is required')
  }
  if (!isAbsolute(config.demoRoot) || !isAbsolute(cwd)) {
    throw new Error('sandbox-test: demoRoot and the Agent Session cwd must be absolute')
  }

  const demoRoot = await realpath(config.demoRoot)
  if (demoRoot === parse(demoRoot).root) {
    throw new Error('sandbox-test: a filesystem root cannot be used as the Demo root')
  }
  const rootStat = await lstat(demoRoot)
  if (!rootStat.isDirectory()) {
    throw new Error('sandbox-test: demoRoot must resolve to a directory')
  }

  const markerPath = join(demoRoot, DEMO_MARKER)
  assertDirectChild(demoRoot, markerPath, DEMO_MARKER)
  const markerStat = await lstat(markerPath)
  if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
    throw new Error(`sandbox-test: demoRoot must contain a regular ${DEMO_MARKER} safety marker`)
  }
  if (await readFile(markerPath, 'utf8') !== DEMO_MARKER_CONTENT) {
    throw new Error(`sandbox-test: ${DEMO_MARKER} has unexpected content`)
  }

  const projectRoot = await directDirectory(demoRoot, 'project')
  const outsideRoot = await directDirectory(demoRoot, 'outside')
  if (await realpath(cwd) !== projectRoot) {
    throw new Error('sandbox-test: the Session cwd must be exactly demoRoot/project')
  }

  const gitMarker = await optionalLstat(join(projectRoot, '.git'))
  if (
    gitMarker === undefined
    || gitMarker.isSymbolicLink()
    || (!gitMarker.isDirectory() && !gitMarker.isFile())
  ) {
    throw new Error('sandbox-test: demoRoot/project must be a Git workspace with a non-symlink .git marker')
  }

  const insidePath = join(projectRoot, INSIDE_FILE)
  const outsidePath = join(outsideRoot, OUTSIDE_FILE)
  assertDirectChild(projectRoot, insidePath, INSIDE_FILE)
  assertDirectChild(outsideRoot, outsidePath, OUTSIDE_FILE)
  return { demoRoot, projectRoot, outsideRoot, insidePath, outsidePath }
}

async function assertTargetsAbsent(layout: DemoLayout): Promise<void> {
  if (
    await optionalLstat(layout.insidePath) !== undefined
    || await optionalLstat(layout.outsidePath) !== undefined
  ) {
    throw new Error('sandbox-test: Demo target files already exist; inspect and reset the two exact files before rerunning')
  }
}

function demoCommand(): string {
  return [
    'set -uC',
    'denied=0',
    'attempt_write() {',
    '  label=$1',
    '  target=$2',
    `  if printf '%s\\n' '${WRITTEN_TEXT}' > "$target"; then`,
    '    printf "%s=written\\n" "$label"',
    '  else',
    '    status=$?',
    '    denied=1',
    '    printf "%s=denied:%s\\n" "$label" "$status"',
    '  fi',
    '}',
    `attempt_write inside './${INSIDE_FILE}'`,
    `attempt_write outside '../outside/${OUTSIDE_FILE}'`,
    'exit "$denied"',
  ].join('\n')
}

async function inspectTarget(path: string): Promise<TargetState> {
  const stat = await optionalLstat(path)
  if (stat === undefined) return { exists: false, contentVerified: false }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('sandbox-test: a Demo target became a non-regular file; refusing to inspect it')
  }
  return {
    exists: true,
    contentVerified: await readFile(path, 'utf8') === WRITTEN_CONTENT,
  }
}

function sandboxObservation(result: ShellRunResult) {
  return result.sandbox === undefined
    ? null
    : {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        enforcement: result.sandbox.enforcement ?? null,
        runner_failed: result.sandbox.runnerFailed ?? false,
      }
}

function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: JsonValue) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

/** Register the fixed two-write Sandbox boundary demonstration. */
export function apply(ctx: Context, config: Config): void {
  if (ctx.shell.sandboxMode === undefined) {
    throw new Error('sandbox-test: a sandbox-enforcing shell executor is required')
  }

  ctx.systemPrompt.section({
    name: 'tool:sandbox-test-safety',
    order: 165,
    text: SANDBOX_TEST_RULES,
  })

  ctx.tools.register(defineTool({
    name: 'sandbox_write_test',
    description: '运行可见的 Sandbox 边界 Demo：固定尝试写 workspace 内外各一个文件，不接受参数、不覆盖文件、不自动删除，且绝不越出配置的专用 Demo 根目录。',
    parameters: {},
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: async (_args, exec) => {
      const session = exec.agent?.session
      if (session === undefined) {
        throw new Error('sandbox-test: an Agent Session with an explicit Demo project cwd is required')
      }
      const layout = await resolveLayout(config, exec)
      const policy = ctx.sandboxPolicy.resolve({ session })
      const policyRoot = await realpath(policy.workspaceRoot)
      if (policyRoot !== layout.projectRoot) {
        throw new Error('sandbox-test: resolved Sandbox workspace does not match demoRoot/project')
      }
      await assertTargetsAbsent(layout)

      const result = await ctx.shell.run(ctx.shell.resolve({
        command: demoCommand(),
        workdir: layout.projectRoot,
        timeoutMs: config.timeoutMs,
        stdoutMaxBytes: 2_048,
        signal: exec.signal,
        env: {
          BASH_ENV: '',
          ENV: '',
          PATH: '/usr/bin:/bin',
        },
        sandboxPolicy: policy,
      }))

      const inside = await inspectTarget(layout.insidePath)
      const outside = await inspectTarget(layout.outsidePath)
      const expected = EXPECTED[policy.mode]
      const checks = {
        mode_reported: result.sandbox?.mode === policy.mode,
        runner_started: result.sandbox?.runnerFailed !== true,
        command_status_matches: expected.sandboxDenied ? result.exitCode !== 0 : result.exitCode === 0,
        not_timed_out: !result.timedOut,
        not_aborted: !result.aborted,
        both_attempts_reported: result.stdout.text.includes('inside=') && result.stdout.text.includes('outside='),
        denial_report_matches: result.sandbox?.denied === expected.sandboxDenied,
        inside_boundary_matches: expected.insideWritten ? inside.contentVerified : !inside.exists,
        outside_boundary_matches: expected.outsideWritten ? outside.contentVerified : !outside.exists,
      }

      return {
        mode: policy.mode,
        passed: Object.values(checks).every(Boolean),
        expected: {
          inside_written: expected.insideWritten,
          outside_written: expected.outsideWritten,
        },
        observed: {
          inside: {
            relative_path: `project/${INSIDE_FILE}`,
            exists_after: inside.exists,
            content_verified: inside.contentVerified,
          },
          outside: {
            relative_path: `outside/${OUTSIDE_FILE}`,
            exists_after: outside.exists,
            content_verified: outside.contentVerified,
          },
          shell: {
            exit_code: result.exitCode,
            signal: result.signal,
            stdout: result.stdout.text,
            stderr: result.stderr.text,
            sandbox: sandboxObservation(result),
          },
        },
        checks,
        safety: {
          scope: 'configured-demo-root-only',
          demo_root: layout.demoRoot,
          workspace_root: layout.projectRoot,
          outside_root: layout.outsideRoot,
          accepts_model_path_or_command: false,
          overwrites_preexisting_targets: false,
          automatic_cleanup: false,
          reset_required: inside.exists || outside.exists,
        },
      }
    },
    presentCall: () => ({
      card: 'generic',
      title: '测试 Sandbox workspace 边界',
      kind: 'execute',
    }),
  }))
}

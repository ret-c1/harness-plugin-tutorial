import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { apply } from '../lib/index.js'

const PLUGIN_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const WRITTEN_CONTENT = 'created by sandbox_write_test\n'

function collected(text) {
  return { text, truncated: false }
}

function runFullAccessBash(spec) {
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', spec.command], {
      cwd: spec.workdir,
      env: { ...process.env, ...spec.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.once('error', reject)
    child.once('close', (exitCode, signal) => {
      resolve({
        exitCode,
        signal,
        timedOut: false,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: collected(stdout),
        stderr: collected(stderr),
        sandbox: { mode: 'danger-full-access', denied: false },
      })
    })
  })
}

function setup(mode, demoRoot) {
  const tools = new Map()
  const sections = []
  const calls = []
  const policyRequests = []
  const projectRoot = join(demoRoot, 'project')
  const insidePath = join(projectRoot, 'sandbox-inside.txt')
  const outsidePath = join(demoRoot, 'outside', 'sandbox-outside.txt')
  const shell = {
    sandboxMode: 'workspace-write',
    resolve(request) {
      return {
        workdir: request.workdir,
        timeoutMs: request.timeoutMs ?? 5_000,
        stdoutMaxBytes: request.stdoutMaxBytes ?? 2_048,
        ...request,
      }
    },
    async run(spec) {
      calls.push(spec)
      if (mode === 'danger-full-access') return runFullAccessBash(spec)
      if (mode !== 'read-only') await writeFile(insidePath, WRITTEN_CONTENT, { flag: 'wx' })
      return {
        exitCode: 1,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: collected([
          `inside=${mode === 'read-only' ? 'denied:1' : 'written'}`,
          'outside=denied:1',
          '',
        ].join('\n')),
        stderr: collected('Operation not permitted\n'),
        sandbox: {
          mode,
          denied: true,
          enforcement: 'full',
        },
      }
    },
  }
  const context = {
    shell,
    sandboxPolicy: {
      resolve(request) {
        policyRequests.push(request)
        return { mode, workspaceRoot: request.session.header.cwd, sessionId: request.session.id }
      },
    },
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => undefined
      },
    },
  }
  apply(context, { demoRoot, timeoutMs: 5_000 })
  return { tools, sections, calls, policyRequests }
}

function execution(projectRoot) {
  return {
    callId: 'sandbox-test-call',
    name: 'sandbox_write_test',
    arguments: {},
    signal: new AbortController().signal,
    agent: {
      session: {
        id: 'sandbox-test-session',
        header: { cwd: projectRoot },
      },
    },
  }
}

async function demoFixture(t) {
  const demoRoot = await mkdtemp(join(PLUGIN_ROOT, '.sandbox-demo-unit-'))
  await mkdir(join(demoRoot, 'project', '.git'), { recursive: true })
  await mkdir(join(demoRoot, 'outside'))
  await writeFile(join(demoRoot, '.sandbox-demo-root'), 'sandbox-test-demo-v1\n')
  t.after(async () => { await rm(demoRoot, { recursive: true, force: true }) })
  return {
    demoRoot: await realpath(demoRoot),
    projectRoot: await realpath(join(demoRoot, 'project')),
    insidePath: join(demoRoot, 'project', 'sandbox-inside.txt'),
    outsidePath: join(demoRoot, 'outside', 'sandbox-outside.txt'),
  }
}

test('registers one parameterless, bounded and persistent Demo tool', async (t) => {
  const fixture = await demoFixture(t)
  const { tools, sections } = setup('workspace-write', fixture.demoRoot)

  assert.deepEqual([...tools.keys()], ['sandbox_write_test'])
  assert.deepEqual(tools.get('sandbox_write_test').parameters, { type: 'object', properties: {} })
  assert.match(tools.get('sandbox_write_test').description, /不接受参数、不覆盖文件、不自动删除/)
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /不会访问 Demo 根目录之外的数据路径/)
})

test('read-only leaves both visible Demo targets absent', async (t) => {
  const fixture = await demoFixture(t)
  const { tools, calls, policyRequests } = setup('read-only', fixture.demoRoot)
  const result = await tools.get('sandbox_write_test').execute({}, execution(fixture.projectRoot))

  assert.equal(result.passed, true)
  assert.deepEqual(result.expected, { inside_written: false, outside_written: false })
  assert.equal(result.observed.inside.exists_after, false)
  assert.equal(result.observed.outside.exists_after, false)
  assert.equal(calls[0].sandboxPolicy.mode, 'read-only')
  assert.equal(calls[0].workdir, fixture.projectRoot)
  assert.match(calls[0].command, /> "\$target"/)
  assert.match(calls[0].command, /\.\/sandbox-inside\.txt/)
  assert.match(calls[0].command, /\.\.\/outside\/sandbox-outside\.txt/)
  assert.equal(Object.hasOwn(policyRequests[0], 'mode'), false)
})

test('workspace-write creates only the workspace target', async (t) => {
  const fixture = await demoFixture(t)
  const { tools } = setup('workspace-write', fixture.demoRoot)
  const result = await tools.get('sandbox_write_test').execute({}, execution(fixture.projectRoot))

  assert.equal(result.passed, true)
  assert.deepEqual(result.expected, { inside_written: true, outside_written: false })
  assert.equal(result.observed.inside.content_verified, true)
  assert.equal(result.observed.outside.exists_after, false)
  assert.equal(await readFile(fixture.insidePath, 'utf8'), WRITTEN_CONTENT)
})

test('danger-full-access creates both targets but stays inside demoRoot', async (t) => {
  const fixture = await demoFixture(t)
  const { tools } = setup('danger-full-access', fixture.demoRoot)
  const result = await tools.get('sandbox_write_test').execute({}, execution(fixture.projectRoot))

  assert.equal(result.passed, true)
  assert.deepEqual(result.expected, { inside_written: true, outside_written: true })
  assert.equal(result.observed.inside.content_verified, true)
  assert.equal(result.observed.outside.content_verified, true)
  assert.equal(result.safety.scope, 'configured-demo-root-only')
  assert.equal(result.safety.outside_root, join(fixture.demoRoot, 'outside'))
  assert.equal(await readFile(fixture.insidePath, 'utf8'), WRITTEN_CONTENT)
  assert.equal(await readFile(fixture.outsidePath, 'utf8'), WRITTEN_CONTENT)
})

test('refuses to overwrite either visible target', async (t) => {
  const fixture = await demoFixture(t)
  await writeFile(fixture.insidePath, 'keep me\n')
  const { tools, calls } = setup('danger-full-access', fixture.demoRoot)

  await assert.rejects(
    tools.get('sandbox_write_test').execute({}, execution(fixture.projectRoot)),
    /target files already exist/,
  )
  assert.equal(calls.length, 0)
  assert.equal(await readFile(fixture.insidePath, 'utf8'), 'keep me\n')
})

test('refuses a Session cwd outside the configured Demo project', async (t) => {
  const fixture = await demoFixture(t)
  const wrongRoot = join(fixture.demoRoot, 'wrong-project')
  await mkdir(join(wrongRoot, '.git'), { recursive: true })
  const { tools, calls } = setup('danger-full-access', fixture.demoRoot)

  await assert.rejects(
    tools.get('sandbox_write_test').execute({}, execution(wrongRoot)),
    /Session cwd must be exactly demoRoot\/project/,
  )
  assert.equal(calls.length, 0)
})

test('refuses to load with an unsandboxed shell executor', async (t) => {
  const fixture = await demoFixture(t)
  const context = {
    shell: { sandboxMode: undefined },
    sandboxPolicy: { resolve() { throw new Error('must not resolve') } },
    tools: { register() { throw new Error('must not register') } },
    systemPrompt: { section() { throw new Error('must not register') } },
  }
  assert.throws(
    () => apply(context, { demoRoot: fixture.demoRoot, timeoutMs: 5_000 }),
    /sandbox-enforcing shell executor is required/,
  )
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

const CONFIG = {
  baseUrl: 'http://memory.test/api/v1',
  username: 'user_a',
  password: 'UserA@123',
  timeoutMs: 15_000,
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  }
}

function jsonResponse(status, value) {
  return response(status, JSON.stringify(value))
}

function loginResponse(token = 'test-token') {
  return jsonResponse(200, {
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  })
}

function identityResponse(id = 2, username = 'user_a') {
  return jsonResponse(200, { id, username })
}

function setup(config = CONFIG) {
  const tools = new Map()
  const sections = []
  const context = {
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
  apply(context, config)
  return { tools, sections }
}

function execution(agentId) {
  return {
    signal: new AbortController().signal,
    agent: agentId === undefined ? undefined : { id: agentId },
  }
}

test('defines three memory categories and never exposes a user selector', () => {
  const { tools, sections } = setup()
  assert.equal(tools.size, 17)
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /User Memory 保存当前认证用户跨项目生效/)
  assert.match(sections[0].text, /Project Memory 保存当前认证用户在指定项目中的约定/)
  assert.match(sections[0].text, /Task History 只记录任务执行历史/)
  assert.match(sections[0].text, /不得要求、推断或构造其他用户 ID/)
  assert.match(sections[0].text, /先调用 memory_recall 查询候选记忆/)
  assert.match(sections[0].text, /必须调用 memory_context_apply/)

  for (const definition of tools.values()) {
    assert.doesNotMatch(JSON.stringify(definition.parameters), /user_id/)
  }
})

test('recalls candidates from all three stores with inspector metadata', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    if (requests.length === 2) return identityResponse()
    if (requests.length === 3) {
      return jsonResponse(200, {
        items: [{
          id: 10,
          user_id: 2,
          key: 'risk_preference',
          content: '只关注 critical/high',
          metadata: { source: 'explicit', status: 'active' },
          updated_at: '2026-08-24T00:00:00Z',
        }],
        total: 1,
      })
    }
    if (requests.length === 4) {
      return jsonResponse(200, {
        items: [{
          id: 20,
          user_id: 2,
          project_id: 'harness-plugin',
          key: 'critical_asset_rule',
          content: '核心资产 critical 优先',
          metadata: {},
        }],
        total: 1,
      })
    }
    return jsonResponse(200, {
      items: [{
        id: 30,
        user_id: 2,
        task_id: 'asset-001',
        project_id: 'harness-plugin',
        title: '检查资产风险',
        task_input: '检查资产风险',
        task_output: '存在 2 个 critical 漏洞',
        status: 'completed',
        metadata: {},
      }],
      total: 1,
    })
  }

  const definition = tools.get('memory_recall')
  const value = await definition.execute({
    query: '帮我看看资产风险',
    search: 'risk',
    project_id: 'harness-plugin',
  }, execution('session-001'))

  assert.deepEqual(value.categories, ['user', 'project', 'task'])
  assert.deepEqual(value.candidates.map(candidate => candidate.ref), ['user:10', 'project:20', 'task:30'])
  assert.equal(value.candidates[0].source, 'explicit')
  assert.equal(value.candidates[0].memory_status, 'active')
  assert.match(requests[2].url, /memory\/user-memories\?page=1&page_size=10&search=risk/)
  assert.match(requests[3].url, /memory\/project-memories\?.*project_id=harness-plugin/)
  assert.match(requests[4].url, /memory\/task-history\?.*project_id=harness-plugin/)

  const meta = definition.output.presentationMeta({}, value)
  assert.equal(meta.kind, 'memory-inspector')
  assert.equal(meta.phase, 'recall')
  assert.equal(meta.items.length, 3)
})

test('applies only explicitly selected current-user memories', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    if (requests.length === 2) return identityResponse()
    if (requests.length === 3) {
      return jsonResponse(200, {
        id: 10,
        user_id: 2,
        key: 'risk_preference',
        content: '只关注 critical/high',
        metadata: { source: 'explicit' },
      })
    }
    return jsonResponse(200, {
      id: 20,
      user_id: 2,
      project_id: 'harness-plugin',
      key: 'critical_asset_rule',
      content: '核心资产 critical 优先',
      metadata: {},
    })
  }

  const definition = tools.get('memory_context_apply')
  const value = await definition.execute({
    memories: [
      { category: 'user', id: 10 },
      { category: 'project', id: 20 },
      { category: 'user', id: 10 },
    ],
    reason: '风险偏好和项目规则与本轮资产分析相关',
    intended_effect: '后续资产查询只关注 critical/high，并优先核心资产',
  }, execution('session-001'))

  assert.equal(value.session_id, 'session-001')
  assert.deepEqual(value.memories.map(memory => memory.ref), ['user:10', 'project:20'])
  assert.equal(requests[2].url, 'http://memory.test/api/v1/memory/user-memories/10')
  assert.equal(requests[3].url, 'http://memory.test/api/v1/memory/project-memories/20')
  const meta = definition.output.presentationMeta({}, value)
  assert.equal(meta.phase, 'apply')
  assert.equal(meta.reason, '风险偏好和项目规则与本轮资产分析相关')
  assert.equal(meta.items.length, 2)
})

test('creates User Memory as the authenticated user without sending user_id', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    if (requests.length === 2) return identityResponse()
    return jsonResponse(201, {
      id: 10,
      user_id: 2,
      key: 'response_language',
      content: '使用中文',
      metadata: {},
      created_at: '2026-08-21T00:00:00Z',
      updated_at: '2026-08-21T00:00:00Z',
    })
  }

  const value = await tools.get('user_memory_create').execute({
    key: 'response_language',
    content: '使用中文',
    user_id: 999,
  }, execution())
  assert.equal(value.user_id, 2)
  assert.equal(requests[2].url, 'http://memory.test/api/v1/memory/user-memories')
  assert.equal(requests[2].init.method, 'POST')
  const body = JSON.parse(requests[2].init.body)
  assert.deepEqual(body, { key: 'response_language', content: '使用中文' })
  assert.equal('user_id' in body, false)
})

test('rejects a memory response that belongs to another user', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    if (call === 1) return loginResponse()
    if (call === 2) return identityResponse(2, 'user_a')
    return jsonResponse(200, {
      items: [{ id: 1, user_id: 1, key: 'private', content: 'other user', metadata: {} }],
      total: 1,
      page: 1,
      page_size: 20,
    })
  }

  await assert.rejects(
    tools.get('user_memory_list').execute({}, execution()),
    /接口响应用户不匹配，已拒绝使用其他用户的数据/,
  )
})

test('rejects authentication when /auth/me differs from configured username', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1 ? loginResponse() : identityResponse(1, 'admin')
  }

  await assert.rejects(
    tools.get('user_memory_list').execute({}, execution()),
    /认证用户与配置用户名不一致/,
  )
})

test('creates Project Memory in an explicit project', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    if (requests.length === 2) return identityResponse()
    return jsonResponse(201, {
      id: 20,
      user_id: 2,
      project_id: 'harness-plugin',
      key: 'api_contract',
      content: '保持兼容',
      metadata: {},
    })
  }

  const value = await tools.get('project_memory_create').execute({
    project_id: 'harness-plugin',
    key: 'api_contract',
    content: '保持兼容',
  }, execution())
  assert.equal(value.project_id, 'harness-plugin')
  assert.equal(requests[2].url, 'http://memory.test/api/v1/memory/project-memories')
})

test('uses the current Harness session when Task History omits session_id', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    if (requests.length === 2) return identityResponse()
    const body = JSON.parse(init.body)
    return jsonResponse(201, {
      id: 30,
      user_id: 2,
      ...body,
      status: body.status ?? 'completed',
      metadata: body.metadata ?? {},
    })
  }

  const value = await tools.get('task_history_create').execute({
    task_id: 'task-001',
    title: '实现 Memory 插件',
    task_input: '新增三类记忆工具',
  }, execution('session-001'))
  assert.equal(value.session_id, 'session-001')
  assert.equal(requests[2].url, 'http://memory.test/api/v1/memory/task-history')
})

test('refreshes the bound user authentication once after a 401', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, authorization: init.headers.authorization })
    if (requests.length === 1) return loginResponse('first-token')
    if (requests.length === 2) return identityResponse()
    if (requests.length === 3) return jsonResponse(401, { detail: 'expired' })
    if (requests.length === 4) return loginResponse('second-token')
    if (requests.length === 5) return identityResponse()
    return jsonResponse(200, { items: [], total: 0, page: 1, page_size: 20 })
  }

  const value = await tools.get('project_memory_list').execute({
    project_id: 'harness-plugin',
  }, execution())
  assert.equal(value.total, 0)
  assert.equal(requests.length, 6)
  assert.equal(requests[2].authorization, 'Bearer first-token')
  assert.equal(requests[5].authorization, 'Bearer second-token')
})

test('rejects every non-2xx Memory API response with its status category', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const cases = [
    [400, /请求参数被接口拒绝.*HTTP 400/],
    [403, /当前账号无权访问.*HTTP 403/],
    [404, /记录不存在或不属于当前用户.*HTTP 404/],
    [409, /唯一键发生冲突.*HTTP 409/],
    [422, /接口参数校验失败.*HTTP 422/],
    [429, /接口请求过于频繁.*HTTP 429/],
    [503, /Memory 服务端异常.*HTTP 503/],
  ]

  for (const [status, expected] of cases) {
    const { tools } = setup()
    let call = 0
    globalThis.fetch = async () => {
      call += 1
      if (call === 1) return loginResponse()
      if (call === 2) return identityResponse()
      return jsonResponse(status, { detail: `case-${status}` })
    }

    await assert.rejects(
      tools.get('user_memory_list').execute({}, execution()),
      expected,
    )
  }
})

test('rejects malformed success responses instead of treating them as memory', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    if (call === 1) return loginResponse()
    if (call === 2) return identityResponse()
    return response(200, 'not-json')
  }

  await assert.rejects(
    tools.get('task_history_list').execute({}, execution()),
    /接口成功响应不是有效 JSON/,
  )
})

test('reports network failures without returning remembered data', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  globalThis.fetch = async () => {
    throw new TypeError('connection refused')
  }

  await assert.rejects(
    tools.get('project_memory_list').execute({}, execution()),
    /无法连接 Memory 服务/,
  )
})

test('returns a user-scoped deletion receipt for HTTP 204', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    if (call === 1) return loginResponse()
    if (call === 2) return identityResponse()
    return response(204, '')
  }

  const value = await tools.get('task_history_delete').execute({ history_id: 9 }, execution())
  assert.deepEqual(value, { deleted: true, id: 9, user_id: 2, username: 'user_a' })
})

test('Memory API errors explicitly forbid false read/write claims', () => {
  const { tools } = setup()
  const definition = tools.get('user_memory_create')
  const content = definition.finalizeContent({}, {
    isError: true,
    error: { message: 'memory: user_memory_create：Memory 服务端异常（HTTP 503）' },
    content: [],
  })
  assert.match(content[0].text, /本次 Memory API 操作没有完成/)
  assert.match(content[0].text, /不得声称已读取、保存、修改或删除/)

  assert.equal(definition.finalizeContent({}, {
    isError: true,
    error: { message: 'invalid args', info: { name: 'ToolArgsError', code: 'INVALID_ARGS' } },
    content: [],
  }), undefined)
})

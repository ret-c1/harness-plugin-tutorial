import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

const CONFIG = {
  baseUrl: 'http://security.test/api/v1',
  username: 'user_b',
  password: 'UserB@123',
  timeoutMs: 15_000,
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  }
}

function loginResponse(token = 'test-token') {
  return response(200, JSON.stringify({
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }))
}

function pageResponse(items = []) {
  return response(200, JSON.stringify({
    items,
    total: items.length,
    page: 1,
    page_size: 20,
  }))
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

function execution(signal = new AbortController().signal) {
  return { signal }
}

test('registers six collision-free atomic tools and agent-loop rules', () => {
  const { tools, sections } = setup()
  assert.deepEqual([...tools.keys()], [
    'security_asset_list',
    'security_asset_get',
    'security_vulnerability_list',
    'security_vulnerability_get',
    'security_event_list',
    'security_event_get',
  ])
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /先取得关联 ID，再查询其他实体/)
  assert.match(sections[0].text, /必须继续翻页/)
  assert.match(sections[0].text, /不得使用会话记忆、历史工具结果、模型知识或猜测/)
  for (const definition of tools.values()) {
    assert.match(definition.description, /只读原子查询/)
  }
})

test('maps every tool to one entity endpoint and keeps the login token cached', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  const businessResponses = [
    pageResponse([{ id: 9, asset_code: 'ASSET-009' }]),
    response(200, JSON.stringify({
      id: 9,
      asset_code: 'ASSET-009',
      vulnerabilities: [{ id: 11 }],
      security_events: [{ id: 21 }],
    })),
    pageResponse([{ id: 11, asset_ids: [9] }]),
    response(200, JSON.stringify({ id: 11, asset_ids: [9] })),
    pageResponse([{ id: 21, asset_ids: [9] }]),
    response(200, JSON.stringify({ id: 21, asset_ids: [9] })),
  ]

  globalThis.fetch = async (url, init) => {
    requests.push({ url, init })
    if (requests.length === 1) return loginResponse()
    const next = businessResponses.shift()
    assert.ok(next, `unexpected request: ${url}`)
    return next
  }

  await tools.get('security_asset_list').execute(
    { criticality: 'critical', page: 2, page_size: 50 },
    execution(),
  )
  const asset = await tools.get('security_asset_get').execute({ asset_id: 9 }, execution())
  await tools.get('security_vulnerability_list').execute(
    { asset_id: 9, severity: 'high', status: 'no_response' },
    execution(),
  )
  await tools.get('security_vulnerability_get').execute(
    { vulnerability_id: 11 },
    execution(),
  )
  await tools.get('security_event_list').execute(
    { asset_id: 9, category: 'malware' },
    execution(),
  )
  await tools.get('security_event_get').execute({ event_id: 21 }, execution())

  assert.deepEqual(asset, { id: 9, asset_code: 'ASSET-009' })
  assert.equal(requests.length, 7)
  assert.equal(requests[0].url, 'http://security.test/api/v1/auth/login')
  assert.equal(requests[0].init.method, 'POST')
  assert.equal(
    requests[1].url,
    'http://security.test/api/v1/assets?criticality=critical&page=2&page_size=50',
  )
  assert.equal(requests[2].url, 'http://security.test/api/v1/assets/9')
  assert.equal(
    requests[3].url,
    'http://security.test/api/v1/vulnerabilities?asset_id=9&severity=high&status=no_response',
  )
  assert.equal(requests[4].url, 'http://security.test/api/v1/vulnerabilities/11')
  assert.equal(
    requests[5].url,
    'http://security.test/api/v1/security-events?asset_id=9&category=malware',
  )
  assert.equal(requests[6].url, 'http://security.test/api/v1/security-events/21')
  for (const request of requests.slice(1)) {
    assert.equal(request.init.headers.authorization, 'Bearer test-token')
  }
})

test('refreshes authentication once after a protected endpoint returns 401', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const requests = []
  globalThis.fetch = async (url, init) => {
    requests.push({ url, authorization: init.headers?.authorization })
    if (requests.length === 1) return loginResponse('first-token')
    if (requests.length === 2) return response(401, '{"detail":"expired"}')
    if (requests.length === 3) return loginResponse('second-token')
    return pageResponse()
  }

  const value = await tools.get('security_event_list').execute({}, execution())
  assert.equal(value.total, 0)
  assert.equal(requests.length, 4)
  assert.equal(requests[1].authorization, 'Bearer first-token')
  assert.equal(requests[3].authorization, 'Bearer second-token')
})

test('rejects malformed entity and pagination responses', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const malformedPageSetup = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1
      ? loginResponse()
      : response(200, '{"items":{},"total":0,"page":1,"page_size":20}')
  }
  await assert.rejects(
    malformedPageSetup.tools.get('security_vulnerability_list').execute({}, execution()),
    /接口分页响应字段 items 必须是数组/,
  )

  const malformedEntitySetup = setup()
  call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1 ? loginResponse() : response(200, '[]')
  }
  await assert.rejects(
    malformedEntitySetup.tools.get('security_event_get').execute({ event_id: 1 }, execution()),
    /接口响应必须是对象/,
  )
})

for (const [status, expected] of [
  [400, '请求参数被接口拒绝'],
  [403, '当前账号无权访问'],
  [404, '请求的资源不存在'],
  [429, '接口请求过于频繁'],
  [503, '安全数据服务端异常'],
]) {
  test(`reports HTTP ${status} without returning fallback data`, async (t) => {
    const originalFetch = globalThis.fetch
    t.after(() => { globalThis.fetch = originalFetch })
    const { tools } = setup()
    let call = 0
    globalThis.fetch = async () => {
      call += 1
      return call === 1
        ? loginResponse()
        : response(status, JSON.stringify({ detail: '测试错误详情' }))
    }

    await assert.rejects(
      tools.get('security_asset_list').execute({}, execution()),
      (error) => {
        assert.match(error.message, new RegExp(expected))
        assert.match(error.message, new RegExp(`HTTP ${status}`))
        assert.match(error.message, /测试错误详情/)
        return true
      },
    )
  })
}

test('reports network, abort, and invalid-success-response failures', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const networkSetup = setup()
  globalThis.fetch = async () => { throw new Error('connection refused') }
  await assert.rejects(
    networkSetup.tools.get('security_asset_list').execute({}, execution()),
    /无法连接安全数据服务/,
  )

  const abortedSetup = setup()
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (_url, init) => {
    init.signal.throwIfAborted()
  }
  await assert.rejects(
    abortedSetup.tools.get('security_asset_list').execute({}, execution(controller.signal)),
    /请求已取消或超时/,
  )

  const invalidJsonSetup = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1 ? loginResponse() : response(200, '<html>not json</html>')
  }
  await assert.rejects(
    invalidJsonSetup.tools.get('security_asset_list').execute({}, execution()),
    /接口成功响应不是有效 JSON/,
  )
})

test('failure content explicitly forbids memory fallback', () => {
  const { tools } = setup()
  const definition = tools.get('security_asset_list')
  const content = definition.finalizeContent({}, {
    isError: true,
    error: { message: 'security-atomic: security_asset_list：安全数据服务端异常（HTTP 503）' },
    content: [],
  })
  assert.match(content[0].text, /必须明确告知用户安全数据接口调用失败/)
  assert.match(content[0].text, /不得使用会话记忆、历史工具结果或模型知识补齐答案/)

  assert.equal(definition.finalizeContent({}, {
    isError: true,
    error: { message: 'invalid args', info: { name: 'ToolArgsError', code: 'INVALID_ARGS' } },
    content: [],
  }), undefined)

  assert.equal(definition.finalizeContent({}, {
    isError: true,
    error: { message: 'approval denied', info: { name: 'PolicyError', code: 'DENIED' } },
    content: [],
  }), undefined)
})

import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

const CONFIG = {
  baseUrl: 'http://assets.test/api/v1',
  username: 'user_b',
  password: 'UserB@123',
  timeoutMs: 15_000,
  criticalAssetWeight: 3,
  highAssetWeight: 2,
  internetExposureWeight: 2,
  intranetExposureWeight: 1,
  unownedAssetWeight: 1,
  criticalFindingWeight: 4,
  highFindingWeight: 2,
  noResponseWeight: 1,
  highRiskScore: 7,
  criticalRiskScore: 12,
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

function setup() {
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
  apply(context, CONFIG)
  return { tools, sections }
}

function execution() {
  return { signal: new AbortController().signal }
}

test('registers realtime-data grounding rules and marks every tool', () => {
  const { tools, sections } = setup()
  assert.equal(sections.length, 1)
  assert.match(sections[0].text, /不得用会话记忆、先前工具结果、模型知识或猜测替代本轮实时查询/)
  assert.match(sections[0].text, /工具返回空列表是一次有效的实时结果/)
  assert.equal(tools.size, 5)
  for (const definition of tools.values()) {
    assert.match(definition.description, /不得使用会话记忆或先前结果代替实时查询/)
  }
})

for (const [status, expected] of [
  [400, '请求参数被接口拒绝'],
  [403, '当前账号无权访问'],
  [404, '请求的资源不存在'],
  [429, '接口请求过于频繁'],
  [503, '资产服务端异常'],
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
      tools.get('asset_list').execute({}, execution()),
      error => {
        assert.match(error.message, new RegExp(expected))
        assert.match(error.message, new RegExp(`HTTP ${status}`))
        assert.match(error.message, /测试错误详情/)
        return true
      },
    )
  })
}

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
    return response(200, '{"items":[],"total":0,"page":1,"page_size":20}')
  }

  const value = await tools.get('asset_list').execute({}, execution())
  assert.equal(value.total, 0)
  assert.equal(requests.length, 4)
  assert.equal(requests[1].authorization, 'Bearer first-token')
  assert.equal(requests[3].authorization, 'Bearer second-token')
})

test('reports authentication failure after one protected-endpoint retry', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    if (call === 1) return loginResponse('first-token')
    if (call === 2) return response(401, '{"detail":"expired"}')
    if (call === 3) return loginResponse('second-token')
    return response(401, '{"detail":"still unauthorized"}')
  }

  await assert.rejects(
    tools.get('asset_list').execute({}, execution()),
    /认证失败或登录已过期（HTTP 401）：still unauthorized/,
  )
  assert.equal(call, 4)
})

test('reports network and invalid-success-response failures', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })

  const networkSetup = setup()
  globalThis.fetch = async () => { throw new Error('connection refused') }
  await assert.rejects(
    networkSetup.tools.get('asset_list').execute({}, execution()),
    /无法连接资产服务/,
  )

  const invalidJsonSetup = setup()
  let call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1 ? loginResponse() : response(200, '<html>not json</html>')
  }
  await assert.rejects(
    invalidJsonSetup.tools.get('asset_list').execute({}, execution()),
    /接口成功响应不是有效 JSON/,
  )

  const emptyResponseSetup = setup()
  call = 0
  globalThis.fetch = async () => {
    call += 1
    return call === 1 ? loginResponse() : response(204, '')
  }
  await assert.rejects(
    emptyResponseSetup.tools.get('asset_list').execute({}, execution()),
    /接口成功响应缺少 JSON 内容/,
  )
})

test('reports an aborted request without returning partial data', async (t) => {
  const originalFetch = globalThis.fetch
  t.after(() => { globalThis.fetch = originalFetch })
  const { tools } = setup()
  const controller = new AbortController()
  controller.abort()
  globalThis.fetch = async (_url, init) => {
    init.signal.throwIfAborted()
  }

  await assert.rejects(
    tools.get('asset_list').execute({}, { signal: controller.signal }),
    /请求已取消或超时/,
  )
})

test('failure content explicitly forbids memory fallback', () => {
  const { tools } = setup()
  const definition = tools.get('asset_list')
  const content = definition.finalizeContent({}, {
    isError: true,
    error: { message: 'asset-management: asset_list：资产服务端异常（HTTP 503）' },
    content: [],
  })
  assert.match(content[0].text, /必须明确告知用户资产接口调用失败/)
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

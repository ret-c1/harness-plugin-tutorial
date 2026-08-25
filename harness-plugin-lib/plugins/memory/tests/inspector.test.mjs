import assert from 'node:assert/strict'
import test from 'node:test'

let bundleLoad = 0

async function loadClientBundle() {
  let registration
  const previousWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(value) {
        registration = value
      },
    },
  }
  try {
    bundleLoad += 1
    await import(`../lib/client.js?test=${bundleLoad}`)
  } finally {
    if (previousWindow === undefined) delete globalThis.window
    else globalThis.window = previousWindow
  }

  assert.equal(registration.id, '@security-harness/memory')
  const client = registration.factory((id) => {
    if (id === 'react') return { memo: component => component }
    if (id === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
    if (id === '@deepseek-ai/dsh-client-runtime/client') {
      return { isAppendSurfaceEvent: event => event.surfaceOp === 'append' }
    }
    throw new Error(`unexpected browser external: ${id}`)
  })
  return client
}

const userMemory = {
  ref: 'user:10',
  category: 'user',
  id: 10,
  key: 'risk_preference',
  content: '只关注 critical/high',
  source: 'explicit',
  memoryStatus: 'active',
}

const projectMemory = {
  ref: 'project:20',
  category: 'project',
  id: 20,
  key: 'critical_asset_rule',
  content: '核心资产 critical 优先',
  projectId: 'harness-plugin',
}

const taskMemory = {
  ref: 'task:30',
  category: 'task',
  id: 30,
  key: 'asset-001',
  title: '检查资产风险',
  content: '存在 2 个 critical 漏洞',
  taskStatus: 'completed',
}

test('client bundle exposes the Memory Inspector and registers its turn-tail slot', async () => {
  const client = await loadClientBundle()
  const definitions = []
  const slots = []
  const context = {
    conversationEvents: {
      register(definition) {
        definitions.push(definition)
      },
    },
    slots: {
      inject(name, callback) {
        slots.push({ type: 'inject', name })
        callback()
      },
      register(definition, component) {
        slots.push({ type: 'register', definition, component })
      },
    },
  }

  client.apply(context)

  assert.deepEqual(client.inject, ['slots', 'conversationEvents'])
  assert.equal(definitions[0].kind, 'memoryInspector')
  assert.equal(slots[0].name, 'conversation.chat.turnTail')
  assert.equal(slots[1].definition.name, 'conversation.chat.turnTail')
  assert.equal(slots[1].component, client.MemoryInspector)
})

test('selector distinguishes applied and unused candidates and bounds actions by turn seq', async () => {
  const client = await loadClientBundle()
  const data = {
    recalls: [{
      seq: 3,
      query: '帮我看看资产风险',
      items: [userMemory, projectMemory, taskMemory],
    }],
    applications: [{
      seq: 5,
      reason: '用户偏好和项目规则与本轮相关',
      intendedEffect: '查询仅使用 critical/high 严重性',
      items: [userMemory, projectMemory],
    }, {
      seq: 15,
      reason: '本轮关闭点之后的内容',
      items: [taskMemory],
    }],
    actions: [{
      seq: 6,
      name: 'list_assets',
      args: { severity: ['critical', 'high'] },
    }, {
      seq: 16,
      name: 'late_tool',
      args: {},
    }],
  }
  const owner = {
    seq: 10,
    turn: {
      data: {
        get(key) {
          return key === 'memoryInspector' ? data : undefined
        },
      },
    },
  }

  const view = client.selectMemoryInspector(owner)

  assert.deepEqual(view.queries, ['帮我看看资产风险'])
  assert.deepEqual(view.store.map(item => item.ref), ['user:10', 'project:20', 'task:30'])
  assert.deepEqual(view.applied.map(item => item.ref), ['user:10', 'project:20'])
  assert.deepEqual(view.unused.map(item => item.ref), ['task:30'])
  assert.deepEqual(view.reasons, ['用户偏好和项目规则与本轮相关'])
  assert.deepEqual(view.intendedEffects, ['查询仅使用 critical/high 严重性'])
  assert.deepEqual(view.actions, [{
    seq: 6,
    name: 'list_assets',
    args: { severity: ['critical', 'high'] },
  }])
})

test('turn projection consumes durable presentation metadata before recording actions', async () => {
  const client = await loadClientBundle()
  const definition = client.memoryInspectorDefinition
  const started = {
    seq: 1,
    type: 'turn/start',
    data: { turn: 4 },
  }
  const startMatch = definition.match(started)
  assert.equal(startMatch.role, 'start')
  let state = definition.start({}, { event: started })

  const recalled = {
    seq: 3,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 4,
      message: { content: [{ isError: false }] },
      meta: {
        kind: 'memory-inspector',
        version: 1,
        phase: 'recall',
        query: '帮我看看资产风险',
        items: [{
          ref: 'user:10',
          category: 'user',
          id: 10,
          key: 'risk_preference',
          content: '只关注 critical/high',
          source: 'explicit',
          memory_status: 'active',
        }],
      },
    },
  }
  assert.equal(definition.match(recalled).role, 'update')
  state = definition.update({ state }, { event: recalled })

  const applied = {
    seq: 5,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 4,
      message: { content: [{ isError: false }] },
      meta: {
        kind: 'memory-inspector',
        version: 1,
        phase: 'apply',
        reason: '用户偏好与本轮相关',
        intended_effect: '限制查询严重性',
        items: [{
          ref: 'user:10',
          category: 'user',
          id: 10,
          key: 'risk_preference',
          content: '只关注 critical/high',
        }],
      },
    },
  }
  state = definition.update({ state }, { event: applied })

  const action = {
    seq: 6,
    type: 'tool/call',
    data: {
      turn: 4,
      name: 'asset_list',
      arguments: '{"severity":["critical","high"]}',
    },
  }
  state = definition.update({ state }, { event: action })

  const location = definition.buildLocationData({ state }, 'turn')
  assert.equal(definition.kind, location.key)
  assert.equal(location.key, 'memoryInspector')
  assert.equal(location.turn, 4)
  assert.equal(location.value.recalls[0].items[0].memoryStatus, 'active')
  assert.equal(location.value.applications[0].intendedEffect, '限制查询严重性')
  assert.deepEqual(location.value.actions[0].args, {
    severity: ['critical', 'high'],
  })
})

test('turn projection folds PTC code-dispatch Memory calls and their subsequent actions', async () => {
  const client = await loadClientBundle()
  const definition = client.memoryInspectorDefinition
  const started = { seq: 1, type: 'turn/start', data: { turn: 7 } }
  let state = definition.start({}, { event: started })

  const rootCall = {
    seq: 2,
    type: 'tool/call',
    data: { turn: 7, step: 1, callId: 'root-7', name: 'run_code', arguments: '{}' },
  }
  assert.equal(definition.match(rootCall).id, '7')
  state = definition.update({ state }, { event: rootCall })

  const dispatch = (seq, name, value) => ({
    seq,
    type: 'tool/code-dispatch',
    data: {
      rootCallId: 'root-7',
      parentCallId: 'root-7',
      subCallId: `sub-${seq}`,
      name,
      arguments: name === 'asset_list' ? { severity: ['critical', 'high'] } : {},
      content: [{ type: 'text', text: JSON.stringify(value) }],
      isError: false,
    },
  })
  const recalled = dispatch(3, 'memory_recall', {
    query: '资产风险',
    candidates: [{
      ref: 'user:10',
      category: 'user',
      id: 10,
      key: 'risk_preference',
      content: '只关注 critical/high',
    }],
  })
  assert.equal(definition.match(recalled).id, '7')
  state = definition.update({ state }, { event: recalled })

  const applied = dispatch(4, 'memory_context_apply', {
    reason: '用户风险偏好与本轮相关',
    intended_effect: '限制资产查询严重性',
    memories: [{
      ref: 'user:10',
      category: 'user',
      id: 10,
      key: 'risk_preference',
      content: '只关注 critical/high',
    }],
  })
  state = definition.update({ state }, { event: applied })

  const action = dispatch(5, 'asset_list', { items: [] })
  state = definition.update({ state }, { event: action })

  const location = definition.buildLocationData({ state }, 'turn')
  assert.deepEqual(location.value.recalls[0].items.map(item => item.ref), ['user:10'])
  assert.deepEqual(location.value.applications[0].items.map(item => item.ref), ['user:10'])
  assert.deepEqual(location.value.actions, [{
    seq: 5,
    name: 'asset_list',
    args: { severity: ['critical', 'high'] },
  }])

  const rootResult = {
    seq: 6,
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn: 7,
      step: 1,
      message: {
        source: { callId: 'root-7' },
        content: [{ isError: false }],
      },
    },
  }
  assert.equal(definition.match(rootResult).id, '7')
  assert.equal(definition.match(dispatch(7, 'asset_get', {})), null)
})

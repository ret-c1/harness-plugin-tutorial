import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/index.js'

function setup() {
  let listener
  const context = {
    on(event, callback) {
      assert.equal(event, 'tools/pre-execute')
      listener = callback
      return () => undefined
    },
  }
  apply(context)
  assert.equal(typeof listener, 'function')
  return listener
}

async function decide(toolName, downstream = { kind: 'allow' }) {
  const listener = setup()
  let nextCalls = 0
  const decision = await listener(
    { name: toolName },
    async () => {
      nextCalls += 1
      return downstream
    },
  )
  return { decision, nextCalls }
}

for (const toolName of ['query_assets', 'assess_asset_risk']) {
  test(`${toolName} delegates as allow`, async () => {
    const result = await decide(toolName)
    assert.deepEqual(result.decision, { kind: 'allow' })
    assert.equal(result.nextCalls, 1)
  })
}

test('update_asset asks for approval without dispatching downstream policy', async () => {
  const result = await decide('update_asset')
  assert.deepEqual(result.decision, {
    kind: 'ask',
    reason: '治理策略：update_asset 会修改资产，需要用户确认。',
  })
  assert.equal(result.nextCalls, 0)
})

test('delete_asset is denied without dispatching downstream policy', async () => {
  const result = await decide('delete_asset')
  assert.deepEqual(result.decision, {
    kind: 'deny',
    reason: '治理策略：禁止调用 delete_asset。',
  })
  assert.equal(result.nextCalls, 0)
})

test('unlisted tools remain governed by downstream listeners', async () => {
  const downstream = { kind: 'deny', reason: 'downstream policy' }
  const result = await decide('unlisted_tool', downstream)
  assert.deepEqual(result.decision, downstream)
  assert.equal(result.nextCalls, 1)
})

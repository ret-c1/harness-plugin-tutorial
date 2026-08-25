import assert from 'node:assert/strict'
import test from 'node:test'

import { apply } from '../lib/demo-tools.js'

function setup() {
  const tools = new Map()
  const context = {
    tools: {
      register(definition) {
        tools.set(definition.name, definition)
        return () => tools.delete(definition.name)
      },
    },
  }
  apply(context)
  return tools
}

test('registers four side-effect-free Governance tutorial tools', async () => {
  const tools = setup()
  assert.deepEqual([...tools.keys()], [
    'query_assets',
    'assess_asset_risk',
    'update_asset',
    'delete_asset',
  ])

  for (const [toolName, definition] of tools) {
    assert.match(definition.description, /不访问 API、不读取或修改任何业务数据/)
    const result = await definition.execute({}, {
      signal: new AbortController().signal,
    })
    assert.deepEqual(result, {
      tool: toolName,
      executed: true,
      side_effects: false,
      message: 'Governance 教学测试桩已执行；未访问 API，未读写任何业务数据。',
    })
  }
})

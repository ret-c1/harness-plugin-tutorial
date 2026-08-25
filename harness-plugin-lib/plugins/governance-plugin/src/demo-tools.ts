/** Side-effect-free tools used only by the Governance tutorial. */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

const TOOL_NAMES = [
  'query_assets',
  'assess_asset_risk',
  'update_asset',
  'delete_asset',
] as const

type DemoToolName = (typeof TOOL_NAMES)[number]

/** Cordis plugin name for the opt-in tutorial fixture. */
export const name = 'governance-demo-tools'

/** Tool registry is required before the fixture registers its tools. */
export const inject = ['tools']

function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: JsonValue) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

function description(toolName: DemoToolName): string {
  return `Governance 教学测试桩 ${toolName}：只返回固定 JSON，不访问 API、不读取或修改任何业务数据。仅在用户明确测试治理策略时调用。`
}

/** Register four harmless names so all Governance decisions can be observed in Harness. */
export function apply(ctx: Context): void {
  for (const toolName of TOOL_NAMES) {
    ctx.tools.register(defineTool({
      name: toolName,
      description: description(toolName),
      parameters: {},
      output: jsonOutput(),
      execute: async () => ({
        tool: toolName,
        executed: true,
        side_effects: false,
        message: 'Governance 教学测试桩已执行；未访问 API，未读写任何业务数据。',
      }),
      presentCall: () => ({
        card: 'generic',
        title: `治理测试：${toolName}`,
        kind: 'read',
      }),
    }))
  }
}

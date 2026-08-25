/** Minimal allow / ask / deny policy for selected asset tools. */

import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'governance-plugin'

/** Tool runtime is required for the pre-execute hook. */
export const inject = ['tools']

/** Install the minimal governance policy. */
export function apply(ctx: Context): void {
  ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    switch (exec.name) {
      case 'query_assets':
      case 'assess_asset_risk':
        return next()
      case 'update_asset':
        return { kind: 'ask', reason: '治理策略：update_asset 会修改资产，需要用户确认。' }
      case 'delete_asset':
        return { kind: 'deny', reason: '治理策略：禁止调用 delete_asset。' }
      default:
        return next()
    }
  })
}

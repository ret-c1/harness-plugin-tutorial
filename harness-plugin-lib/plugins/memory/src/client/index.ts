/** Browser half of the Memory plugin: per-turn Memory Inspector panel. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MemoryInspector } from './MemoryInspector.js'
import { memoryInspectorDefinition, selectMemoryInspector } from './inspector.js'

export { MemoryInspector, type MemoryInspectorProps } from './MemoryInspector.js'
export {
  memoryInspectorDefinition,
  selectMemoryInspector,
  type InspectorAction,
  type InspectorMemory,
  type MemoryInspectorTurnData,
  type MemoryInspectorView,
} from './inspector.js'

/** Services required for turn projection and the conversation tail Slot. */
export const inject = ['slots', 'conversationEvents']

/** Register the durable Memory projection and its additive turn-tail panel. */
export function apply(ctx: ClientContext): void {
  ctx.conversationEvents.register(memoryInspectorDefinition)
  ctx.slots.inject(
    'conversation.chat.turnTail',
    () => ctx.slots.register({
      name: 'conversation.chat.turnTail',
      select: selectMemoryInspector,
    }, MemoryInspector),
  )
}

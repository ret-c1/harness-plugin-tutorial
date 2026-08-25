/** Turn-scoped Memory recall, context application, and action projection. */
import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-client-runtime/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'

export type InspectorCategory = 'user' | 'project' | 'task'

const MAX_INSPECTOR_CONTENT_LENGTH = 600

/** Bounded, user-owned Memory facts persisted in tool presentation metadata. */
export interface InspectorMemory {
  readonly ref: string
  readonly category: InspectorCategory
  readonly id: number
  readonly key: string
  readonly content: string
  readonly title?: string
  readonly projectId?: string
  readonly source?: string
  readonly memoryStatus?: string
  readonly taskStatus?: string
  readonly updatedAt?: string
}

interface RecallTrace {
  readonly seq: number
  readonly query?: string
  readonly search?: string
  readonly items: readonly InspectorMemory[]
}

interface ApplyTrace {
  readonly seq: number
  readonly reason?: string
  readonly intendedEffect?: string
  readonly items: readonly InspectorMemory[]
}

/** A non-Memory tool call made after Memory Context was successfully applied. */
export interface InspectorAction {
  readonly seq: number
  readonly name: string
  readonly args: unknown
}

/** Immutable Memory facts published against one Harness Turn. */
export interface MemoryInspectorTurnData {
  readonly recalls: readonly RecallTrace[]
  readonly applications: readonly ApplyTrace[]
  readonly actions: readonly InspectorAction[]
}

/** Selector-owned view consumed by the turn-tail panel. */
export interface MemoryInspectorView {
  readonly queries: readonly string[]
  readonly store: readonly InspectorMemory[]
  readonly applied: readonly InspectorMemory[]
  readonly unused: readonly InspectorMemory[]
  readonly reasons: readonly string[]
  readonly intendedEffects: readonly string[]
  readonly actions: readonly InspectorAction[]
}

declare module '@deepseek-ai/dsh-client-runtime/client' {
  interface ConversationTurnDataMap {
    /** Memory candidates, explicit context applications, and subsequent actions. */
    memoryInspector: MemoryInspectorTurnData
  }
}

interface MemoryInspectorState extends MemoryInspectorTurnData {
  readonly turn: number
}

interface InspectorMeta {
  readonly phase: 'recall' | 'apply'
  readonly query?: string
  readonly search?: string
  readonly reason?: string
  readonly intendedEffect?: string
  readonly items: readonly InspectorMemory[]
}

interface CodeDispatchEvent {
  readonly type: 'tool/code-dispatch'
  readonly seq: number
  readonly data: {
    readonly rootCallId: string
    readonly name: string
    readonly arguments: unknown
    readonly content: unknown
    readonly isError: boolean
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function codeDispatchEvent(value: unknown): CodeDispatchEvent | undefined {
  if (!isRecord(value) || value['type'] !== 'tool/code-dispatch'
    || typeof value['seq'] !== 'number' || !isRecord(value['data'])) return undefined
  const data = value['data']
  if (typeof data['rootCallId'] !== 'string' || data['rootCallId'] === ''
    || typeof data['name'] !== 'string' || typeof data['isError'] !== 'boolean') return undefined
  return {
    type: 'tool/code-dispatch',
    seq: value['seq'],
    data: {
      rootCallId: data['rootCallId'],
      name: data['name'],
      arguments: data['arguments'],
      content: data['content'],
      isError: data['isError'],
    },
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined
}

function inspectorMemory(value: unknown): InspectorMemory | undefined {
  if (!isRecord(value)) return undefined
  const ref = optionalString(value['ref'])
  const category = value['category']
  const id = value['id']
  const key = optionalString(value['key'])
  const rawContent = optionalString(value['content'])
  if (
    ref === undefined
    || (category !== 'user' && category !== 'project' && category !== 'task')
    || typeof id !== 'number'
    || !Number.isInteger(id)
    || key === undefined
    || rawContent === undefined
  ) return undefined
  const content = rawContent.length <= MAX_INSPECTOR_CONTENT_LENGTH
    ? rawContent
    : `${rawContent.slice(0, MAX_INSPECTOR_CONTENT_LENGTH)}…`
  const title = optionalString(value['title'])
  const projectId = optionalString(value['project_id'])
  const source = optionalString(value['source'])
  const memoryStatus = optionalString(value['memory_status'])
  const taskStatus = optionalString(value['task_status'])
  const updatedAt = optionalString(value['updated_at'])
  return {
    ref,
    category,
    id,
    key,
    content,
    ...(title === undefined ? {} : { title }),
    ...(projectId === undefined ? {} : { projectId }),
    ...(source === undefined ? {} : { source }),
    ...(memoryStatus === undefined ? {} : { memoryStatus }),
    ...(taskStatus === undefined ? {} : { taskStatus }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
  }
}

function inspectorMeta(value: unknown): InspectorMeta | undefined {
  if (!isRecord(value) || value['kind'] !== 'memory-inspector' || value['version'] !== 1) {
    return undefined
  }
  const phase = value['phase']
  if (phase !== 'recall' && phase !== 'apply') return undefined
  const rawItems = value['items']
  if (!Array.isArray(rawItems)) return undefined
  const items = rawItems.flatMap((item) => {
    const parsed = inspectorMemory(item)
    return parsed === undefined ? [] : [parsed]
  })
  const query = optionalString(value['query'])
  const search = optionalString(value['search'])
  const reason = optionalString(value['reason'])
  const intendedEffect = optionalString(value['intended_effect'])
  return {
    phase,
    items,
    ...(query === undefined ? {} : { query }),
    ...(search === undefined ? {} : { search }),
    ...(reason === undefined ? {} : { reason }),
    ...(intendedEffect === undefined ? {} : { intendedEffect }),
  }
}

function textContentJson(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined
  const text = value.flatMap((block) => isRecord(block) && block['type'] === 'text'
    && typeof block['text'] === 'string'
    ? [block['text']]
    : []).join('')
  if (text === '') return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return undefined
  }
}

function dispatchedInspectorMeta(name: string, content: unknown): InspectorMeta | undefined {
  const phase = name === 'memory_recall'
    ? 'recall'
    : name === 'memory_context_apply'
      ? 'apply'
      : undefined
  const value = textContentJson(content)
  if (phase === undefined || !isRecord(value)) return undefined
  const rawItems = value[phase === 'recall' ? 'candidates' : 'memories']
  if (!Array.isArray(rawItems)) return undefined
  const items = rawItems.flatMap((item) => {
    const parsed = inspectorMemory(item)
    return parsed === undefined ? [] : [parsed]
  })
  const query = optionalString(value['query'])
  const search = optionalString(value['search'])
  const reason = optionalString(value['reason'])
  const intendedEffect = optionalString(value['intended_effect'])
  return {
    phase,
    items,
    ...(query === undefined ? {} : { query }),
    ...(search === undefined ? {} : { search }),
    ...(reason === undefined ? {} : { reason }),
    ...(intendedEffect === undefined ? {} : { intendedEffect }),
  }
}

function parsedArguments(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function isMemoryTool(name: string): boolean {
  return name === 'memory_recall'
    || name === 'memory_context_apply'
    || name.startsWith('user_memory_')
    || name.startsWith('project_memory_')
    || name.startsWith('task_history_')
}

// Code-dispatch events carry no Turn coordinate. Root calls do, so retain the
// bounded lifecycle mapping needed to fold their nested calls into the same Turn.
const rootCallTurns = new Map<string, number>()

/** Build the turn-local Memory Inspector data from durable tool events. */
export const memoryInspectorDefinition: ConversationNodeDefinition<MemoryInspectorState> = {
  kind: 'memoryInspector',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') {
      rootCallTurns.set(String(event.data.callId), event.data.turn)
      return { id: String(event.data.turn), role: 'update' }
    }
    const dispatch = codeDispatchEvent(event)
    if (dispatch !== undefined) {
      const turn = rootCallTurns.get(dispatch.data.rootCallId)
      return turn === undefined ? null : { id: String(turn), role: 'update' }
    }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      const rootCallId = event.data.message.source?.callId
      if (rootCallId !== undefined) rootCallTurns.delete(String(rootCallId))
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('memory inspector start requires turn/start')
    return { turn: match.event.data.turn, recalls: [], applications: [], actions: [] }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      if (context.state.applications.length === 0
        || isMemoryTool(match.event.data.name)
        || match.event.data.name === 'run_code') {
        return context.state
      }
      return {
        ...context.state,
        actions: [...context.state.actions, {
          seq: match.event.seq,
          name: match.event.data.name,
          args: parsedArguments(match.event.data.arguments),
        }],
      }
    }
    const dispatch = codeDispatchEvent(match.event)
    if (dispatch !== undefined) {
      if (dispatch.data.isError) return context.state
      const meta = dispatchedInspectorMeta(dispatch.data.name, dispatch.data.content)
      if (meta?.phase === 'recall') {
        return {
          ...context.state,
          recalls: [...context.state.recalls, {
            seq: dispatch.seq,
            items: meta.items,
            ...(meta.query === undefined ? {} : { query: meta.query }),
            ...(meta.search === undefined ? {} : { search: meta.search }),
          }],
        }
      }
      if (meta?.phase === 'apply') {
        return {
          ...context.state,
          applications: [...context.state.applications, {
            seq: dispatch.seq,
            items: meta.items,
            ...(meta.reason === undefined ? {} : { reason: meta.reason }),
            ...(meta.intendedEffect === undefined ? {} : { intendedEffect: meta.intendedEffect }),
          }],
        }
      }
      if (context.state.applications.length === 0 || isMemoryTool(dispatch.data.name)) {
        return context.state
      }
      return {
        ...context.state,
        actions: [...context.state.actions, {
          seq: dispatch.seq,
          name: dispatch.data.name,
          args: dispatch.data.arguments,
        }],
      }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result?.isError === true) return context.state
    const meta = inspectorMeta(match.event.data.meta)
    if (meta === undefined) return context.state
    if (meta.phase === 'recall') {
      return {
        ...context.state,
        recalls: [...context.state.recalls, {
          seq: match.event.seq,
          items: meta.items,
          ...(meta.query === undefined ? {} : { query: meta.query }),
          ...(meta.search === undefined ? {} : { search: meta.search }),
        }],
      }
    }
    return {
      ...context.state,
      applications: [...context.state.applications, {
        seq: match.event.seq,
        items: meta.items,
        ...(meta.reason === undefined ? {} : { reason: meta.reason }),
        ...(meta.intendedEffect === undefined ? {} : { intendedEffect: meta.intendedEffect }),
      }],
    }
  },
  buildLocationData: (context, scope) => scope !== 'turn' || context.state === undefined
    ? null
    : {
      kind: 'turn',
      turn: context.state.turn,
      key: 'memoryInspector',
      value: {
        recalls: context.state.recalls,
        applications: context.state.applications,
        actions: context.state.actions,
      },
    },
}

function uniqueMemories(items: readonly InspectorMemory[]): InspectorMemory[] {
  const unique = new Map<string, InspectorMemory>()
  for (const item of items) unique.set(item.ref, item)
  return [...unique.values()]
}

function nonEmptyUnique(values: readonly (string | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => value !== undefined))]
}

/** Select one completed turn's observable Memory chain before mounting the panel. */
export function selectMemoryInspector(owner: Pick<TurnTailOwnerProps, 'turn' | 'seq'>): MemoryInspectorView | null {
  const data = owner.turn.data.get('memoryInspector')
  if (data === undefined) return null
  const recalls = data.recalls.filter(trace => trace.seq <= owner.seq)
  const applications = data.applications.filter(trace => trace.seq <= owner.seq)
  if (recalls.length === 0 && applications.length === 0) return null
  const store = uniqueMemories(recalls.flatMap(trace => trace.items))
  const applied = uniqueMemories(applications.flatMap(trace => trace.items))
  const appliedRefs = new Set(applied.map(memory => memory.ref))
  return {
    queries: nonEmptyUnique(recalls.map(trace => trace.query)),
    store,
    applied,
    unused: store.filter(memory => !appliedRefs.has(memory.ref)),
    reasons: nonEmptyUnique(applications.map(trace => trace.reason)),
    intendedEffects: nonEmptyUnique(applications.map(trace => trace.intendedEffect)),
    actions: data.actions.filter(action => action.seq <= owner.seq),
  }
}

/** Three-lane Memory Inspector rendered after a completed Harness Turn. */
import { memo } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  InspectorAction,
  InspectorCategory,
  InspectorMemory,
  MemoryInspectorView,
} from './inspector.js'

export interface MemoryInspectorProps {
  readonly matched: MemoryInspectorView
}

const categoryLabels: Record<InspectorCategory, string> = {
  user: 'User',
  project: 'Project',
  task: 'Task',
}

const sourceLabels: Record<string, string> = {
  explicit: '用户明确声明',
  user: '用户明确声明',
  agent: 'Agent 自动总结',
  workflow: 'Workflow 写入',
}

const statusLabels: Record<string, string> = {
  active: 'Active',
  expired: 'Expired',
  superseded: 'Superseded',
}

const rootStyle: CSSProperties = {
  marginTop: 16,
  padding: 14,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 13,
}

const headerStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 12,
}

const flowStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 10,
}

const laneStyle: CSSProperties = {
  minWidth: 0,
  padding: 10,
  border: '1px solid var(--dsw-alias-border-l3)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-base)',
}

const laneTitleStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  margin: '0 0 9px',
  fontSize: 13,
  fontWeight: 600,
}

const cardStyle: CSSProperties = {
  padding: 9,
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}

const badgeStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '1px 6px',
  borderRadius: 999,
  background: 'var(--dsw-alias-interactive-bg-hover)',
  color: 'var(--dsw-alias-label-secondary)',
  fontSize: 11,
  lineHeight: '18px',
}

const mutedStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 12,
}

const contentStyle: CSSProperties = {
  marginTop: 5,
  color: 'var(--dsw-alias-label-secondary)',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
  whiteSpace: 'pre-wrap',
}

const stackStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
}

function memoryTitle(memory: InspectorMemory): string {
  return memory.title === undefined ? memory.key : `${memory.key} · ${memory.title}`
}

function metadata(memory: InspectorMemory): string[] {
  const values: string[] = []
  if (memory.projectId !== undefined) values.push(memory.projectId)
  if (memory.source !== undefined) values.push(sourceLabels[memory.source] ?? memory.source)
  if (memory.memoryStatus !== undefined) {
    values.push(statusLabels[memory.memoryStatus] ?? memory.memoryStatus)
  }
  if (memory.taskStatus !== undefined) values.push(`任务 ${memory.taskStatus}`)
  return values
}

function MemoryCard({ memory, marker }: {
  readonly memory: InspectorMemory
  readonly marker?: 'used' | 'unused'
}) {
  const detail = metadata(memory)
  const markerColor = marker === 'used'
    ? 'var(--dsw-alias-state-success-primary)'
    : 'var(--dsw-alias-label-tertiary)'
  return (
    <article style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        {marker !== undefined && (
          <span style={{ color: markerColor, fontWeight: 700 }} aria-label={marker === 'used' ? '本轮已使用' : '本轮未使用'}>
            {marker === 'used' ? '✓' : '×'}
          </span>
        )}
        <span style={badgeStyle}>{categoryLabels[memory.category]}</span>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={memoryTitle(memory)}>
          {memoryTitle(memory)}
        </strong>
      </div>
      <div style={contentStyle}>{memory.content}</div>
      {detail.length > 0 && <div style={{ ...mutedStyle, marginTop: 6 }}>{detail.join(' · ')}</div>}
    </article>
  )
}

function Empty({ children }: { readonly children: ReactNode }) {
  return <div style={{ ...mutedStyle, padding: '8px 2px' }}>{children}</div>
}

function ActionCard({ action }: { readonly action: InspectorAction }) {
  let args: string
  try {
    args = typeof action.args === 'string' ? action.args : JSON.stringify(action.args, null, 2)
  } catch {
    args = '[参数不可序列化]'
  }
  return (
    <article style={cardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={badgeStyle}>Tool</span>
        <strong>{action.name}</strong>
      </div>
      <pre style={{
        margin: '7px 0 0',
        maxHeight: 150,
        overflow: 'auto',
        color: 'var(--dsw-alias-label-secondary)',
        fontFamily: 'var(--dsw-font-mono)',
        fontSize: 11,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}>
        {args}
      </pre>
    </article>
  )
}

/** Render the observable Store → Recall → Context → Action chain. */
export const MemoryInspector = memo(function MemoryInspector({ matched }: MemoryInspectorProps) {
  return (
    <section style={rootStyle} data-memory-inspector aria-label="Memory Inspector">
      <header style={headerStyle}>
        <div>
          <strong>Memory Inspector</strong>
          {matched.queries.length > 0 && (
            <div style={{ ...mutedStyle, marginTop: 3 }}>查询：{matched.queries.join('；')}</div>
          )}
        </div>
        <div style={flowStyle}>Store → Recall → Context → Action</div>
      </header>

      <div style={gridStyle}>
        <section style={laneStyle}>
          <h4 style={laneTitleStyle}>
            <span>Memory Store</span>
            <span style={mutedStyle}>{matched.store.length} 条候选</span>
          </h4>
          <div style={stackStyle}>
            {matched.store.length === 0
              ? <Empty>本轮检索未命中候选记忆</Empty>
              : matched.store.map(memory => <MemoryCard key={memory.ref} memory={memory} />)}
          </div>
        </section>

        <section style={laneStyle}>
          <h4 style={laneTitleStyle}>
            <span>Recalled Memory</span>
            <span style={mutedStyle}>{matched.applied.length} 条已应用</span>
          </h4>
          {matched.reasons.length > 0 && (
            <div style={{ ...mutedStyle, marginBottom: 8 }}>原因：{matched.reasons.join('；')}</div>
          )}
          {matched.intendedEffects.length > 0 && (
            <div style={{ ...mutedStyle, marginBottom: 8 }}>预期影响：{matched.intendedEffects.join('；')}</div>
          )}
          <div style={stackStyle}>
            {matched.applied.map(memory => (
              <MemoryCard key={`used:${memory.ref}`} memory={memory} marker="used" />
            ))}
            {matched.unused.map(memory => (
              <MemoryCard key={`unused:${memory.ref}`} memory={memory} marker="unused" />
            ))}
            {matched.applied.length === 0 && matched.unused.length === 0 && (
              <Empty>没有 Memory 被应用到本轮上下文</Empty>
            )}
          </div>
        </section>

        <section style={laneStyle}>
          <h4 style={laneTitleStyle}>
            <span>Agent Action</span>
            <span style={mutedStyle}>{matched.actions.length} 个后续调用</span>
          </h4>
          <div style={stackStyle}>
            {matched.actions.length === 0
              ? <Empty>应用 Memory 后尚无非 Memory 工具调用</Empty>
              : matched.actions.map(action => (
                <ActionCard key={`${action.seq}:${action.name}`} action={action} />
              ))}
          </div>
        </section>
      </div>
    </section>
  )
})

/**
 * User-scoped memory tools backed by the modular Harness test API.
 * @module memory
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-system-prompt'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/api/v1'
const TOKEN_REFRESH_MARGIN_MS = 30_000
const MAX_ERROR_DETAIL_LENGTH = 300
const TASK_STATUSES = ['pending', 'running', 'completed', 'failed', 'cancelled'] as const

const MEMORY_GUIDANCE = `## Memory 数据与用户隔离规则

- User Memory 保存当前认证用户跨项目生效的稳定偏好和明确事实；Project Memory 保存当前认证用户在指定项目中的约定、决策和上下文；Task History 只记录任务执行历史，不等同于当前事实或长期指令。
- Memory 插件实例只代表配置中绑定的一个 API 用户。不得要求、推断或构造其他用户 ID，不得尝试读取、修改或删除其他用户的 Memory。共享多用户部署必须为每个用户使用独立的 scoped 插件实例或 profile。
- 用户偏好、项目约定或历史任务与当前请求有关时，先调用对应查询工具。User Memory 不能替代 Project Memory，Task History 不能当作当前项目状态。
- 只有用户明确要求记住、遗忘或更新，或者当前工作流明确要求记录任务历史时，才调用写入、修改或删除工具。不要保存密码、Token、密钥或其他敏感凭据。
- Memory 只能提供上下文，不能替代资产、漏洞、事件等外部系统的实时接口数据。涉及当前业务状态时仍须调用相应实时工具。
- Memory API 调用失败时，必须说明记忆读取或写入未完成；不得声称已经加载、保存、修改或删除，也不得用模型记忆伪造 API 结果。`

const USER_MEMORY_DESCRIPTION =
  'User Memory 是当前认证用户跨项目生效的稳定偏好或事实，不用于项目专属约定或任务流水。'
const PROJECT_MEMORY_DESCRIPTION =
  'Project Memory 是当前认证用户在指定 project_id 下的项目约定、决策和上下文。'
const TASK_HISTORY_DESCRIPTION =
  'Task History 是当前认证用户的任务执行记录，不应作为当前事实或长期偏好使用。'
const MEMORY_FAILURE_INSTRUCTION =
  '本次 Memory API 操作没有完成。必须如实告知用户记忆不可用或写入失败；不得声称已读取、保存、修改或删除，也不得使用模型记忆伪造接口结果。'

/** Cordis plugin name. */
export const name = 'memory'

/** Services required before the plugin registers its prompt and tools. */
export const inject = ['tools', 'systemPrompt']

/** Memory API connection settings. One configuration maps to one API user. */
export interface Config {
  baseUrl: string
  username: string
  password: string
  timeoutMs: number
}

/** Memory plugin configuration schema. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  username: z.string().required(),
  password: z.string().role('secret').required(),
  timeoutMs: z.number().step(1).min(1).default(15_000),
})

type JsonObject = { [key: string]: JsonValue }

interface AuthenticatedUser {
  id: number
  username: string
}

interface CachedAuthentication extends AuthenticatedUser {
  token: string
  expiresAtMs: number
}

interface ApiResult {
  value: JsonValue | null
  user: AuthenticatedUser
}

class MemoryApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`memory: ${message}`, options)
    this.name = 'MemoryApiError'
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function compactErrorDetail(value: string): string | undefined {
  const compact = value.replace(/\s+/g, ' ').trim()
  if (compact === '') return undefined
  return compact.length <= MAX_ERROR_DETAIL_LENGTH
    ? compact
    : `${compact.slice(0, MAX_ERROR_DETAIL_LENGTH)}…`
}

function errorResponseDetail(text: string): string | undefined {
  if (text.trim() === '') return undefined
  try {
    const candidate: unknown = JSON.parse(text)
    if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
      const record = candidate as Record<string, unknown>
      if (typeof record['detail'] === 'string') return compactErrorDetail(record['detail'])
      if (typeof record['message'] === 'string') return compactErrorDetail(record['message'])
    }
  } catch {
    // Keep a bounded non-JSON error body as a diagnostic.
  }
  return compactErrorDetail(text)
}

function httpFailure(operation: string, response: Response, text: string): MemoryApiError {
  const summary = response.status === 400
    ? '请求参数被接口拒绝'
    : response.status === 401
      ? '认证失败或登录已过期'
      : response.status === 403
        ? '当前账号无权访问'
        : response.status === 404
          ? '记录不存在或不属于当前用户'
          : response.status === 408
            ? '接口请求超时'
            : response.status === 409
              ? '当前用户下的唯一键发生冲突'
              : response.status === 422
                ? '接口参数校验失败'
                : response.status === 429
                  ? '接口请求过于频繁'
                  : response.status >= 500
                    ? 'Memory 服务端异常'
                    : '接口返回非成功状态'
  const detail = errorResponseDetail(text)
  return new MemoryApiError(
    `${operation}：${summary}（HTTP ${response.status}）${detail === undefined ? '' : `：${detail}`}`,
  )
}

async function fetchApi(input: string, init: RequestInit, operation: string): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (cause) {
    if (init.signal?.aborted) {
      throw new MemoryApiError(`${operation}：请求已取消或超时`, { cause })
    }
    throw new MemoryApiError(`${operation}：无法连接 Memory 服务，请检查服务状态、地址和网络`, {
      cause,
    })
  }
}

async function responseJson(response: Response, operation: string): Promise<JsonValue> {
  const text = await response.text()
  if (!response.ok) throw httpFailure(operation, response, text)
  if (text === '') throw new MemoryApiError(`${operation}：接口成功响应缺少 JSON 内容`)
  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch (cause) {
    throw new MemoryApiError(`${operation}：接口成功响应不是有效 JSON`, { cause })
  }
  const value = snapshotJsonValue(candidate)
  if (value === undefined) {
    throw new MemoryApiError(`${operation}：接口响应包含不受支持的 JSON 值`)
  }
  return value as JsonValue
}

async function responseEmpty(response: Response, operation: string): Promise<void> {
  const text = await response.text()
  if (!response.ok) throw httpFailure(operation, response, text)
  if (response.status !== 204 || text !== '') {
    throw new MemoryApiError(`${operation}：删除接口必须返回空的 HTTP 204 响应`)
  }
}

function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: JsonValue) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

function finalizeMemoryFailure(
  _exec: unknown,
  result: { isError: boolean, error?: { message: string, info?: { code: string } } },
) {
  if (!result.isError || result.error === undefined) return undefined
  if (result.error.info?.code === 'INVALID_ARGS') return undefined
  const isMemoryFailure = result.error.message.startsWith('memory:')
    || result.error.info?.code === 'TOOL_TIMEOUT'
    || result.error.info?.code === 'ABORTED'
  if (!isMemoryFailure) return undefined
  return [{
    type: 'text' as const,
    text: `Memory API 操作失败：${result.error.message}\n\n${MEMORY_FAILURE_INSTRUCTION}`,
  }]
}

function queryString(values: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) query.set(key, String(value))
  }
  return query.size === 0 ? '' : `?${query.toString()}`
}

function jsonBody(values: Record<string, unknown>): JsonObject {
  const compact = Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  )
  const snapshot = snapshotJsonValue(compact as JsonValue)
  if (snapshot === undefined || !isJsonObject(snapshot)) {
    throw new Error('memory: request body must be lossless JSON')
  }
  return snapshot
}

function requireUpdateBody(body: JsonObject, label: string): JsonObject {
  if (Object.keys(body).length === 0) throw new Error(`${label}：至少提供一个要修改的字段`)
  return body
}

function assertOwnedRecord(value: JsonValue, user: AuthenticatedUser, operation: string): void {
  if (!isJsonObject(value)) {
    throw new MemoryApiError(`${operation}：接口响应必须是对象`)
  }
  const responseUserId = value['user_id']
  if (typeof responseUserId !== 'number' || !Number.isInteger(responseUserId)) {
    throw new MemoryApiError(`${operation}：接口响应缺少有效 user_id`)
  }
  if (responseUserId !== user.id) {
    throw new MemoryApiError(
      `${operation}：接口响应用户不匹配，已拒绝使用其他用户的数据`,
    )
  }
}

function assertOwnedResponse(value: JsonValue, user: AuthenticatedUser, operation: string): void {
  if (!isJsonObject(value)) {
    throw new MemoryApiError(`${operation}：接口响应必须是对象`)
  }
  if ('items' in value) {
    const items = value['items']
    const total = value['total']
    if (!Array.isArray(items) || typeof total !== 'number' || !Number.isInteger(total)) {
      throw new MemoryApiError(`${operation}：接口分页响应格式无效`)
    }
    for (const [index, item] of items.entries()) {
      assertOwnedRecord(item, user, `${operation} items[${index}]`)
    }
    return
  }
  assertOwnedRecord(value, user, operation)
}

/** Register user-scoped memory CRUD tools. */
export function apply(ctx: Context, config: Config): void {
  const configuredUrl = new URL(config.baseUrl)
  if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
    throw new Error('memory: baseUrl must use HTTP or HTTPS')
  }
  if (configuredUrl.search !== '' || configuredUrl.hash !== '') {
    throw new Error('memory: baseUrl must not contain a query or fragment')
  }
  if (configuredUrl.username !== '' || configuredUrl.password !== '') {
    throw new Error('memory: baseUrl must not contain credentials')
  }
  if (config.username.trim() === '') throw new Error('memory: username must not be empty')
  if (config.password === '') throw new Error('memory: password must not be empty')

  ctx.systemPrompt.section({
    name: 'tool:memory-data-boundaries',
    order: 161,
    text: MEMORY_GUIDANCE,
  })

  const baseUrl = configuredUrl.toString().replace(/\/$/, '')
  let cachedAuthentication: CachedAuthentication | undefined

  async function authenticate(signal: AbortSignal): Promise<CachedAuthentication> {
    if (
      cachedAuthentication !== undefined
      && Date.now() + TOKEN_REFRESH_MARGIN_MS < cachedAuthentication.expiresAtMs
    ) {
      return cachedAuthentication
    }

    const loginOperation = 'memory login'
    const loginResponse = await fetchApi(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
      signal,
    }, loginOperation)
    const loginValue = await responseJson(loginResponse, loginOperation)
    if (
      !isJsonObject(loginValue)
      || typeof loginValue['access_token'] !== 'string'
      || typeof loginValue['expires_at'] !== 'number'
      || !Number.isFinite(loginValue['expires_at'])
    ) {
      throw new MemoryApiError(`${loginOperation}：响应必须包含 access_token 和 expires_at`)
    }

    const token = loginValue['access_token']
    const identityOperation = 'memory identify user'
    const identityResponse = await fetchApi(`${baseUrl}/auth/me`, {
      headers: { authorization: `Bearer ${token}` },
      signal,
    }, identityOperation)
    const identity = await responseJson(identityResponse, identityOperation)
    if (
      !isJsonObject(identity)
      || typeof identity['id'] !== 'number'
      || !Number.isInteger(identity['id'])
      || typeof identity['username'] !== 'string'
    ) {
      throw new MemoryApiError(`${identityOperation}：响应缺少有效 id 或 username`)
    }
    if (identity['username'] !== config.username.trim()) {
      throw new MemoryApiError(`${identityOperation}：认证用户与配置用户名不一致`)
    }

    cachedAuthentication = {
      token,
      expiresAtMs: loginValue['expires_at'] * 1000,
      id: identity['id'],
      username: identity['username'],
    }
    return cachedAuthentication
  }

  async function request(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body: JsonObject | undefined,
    signal: AbortSignal,
    operation: string,
    expected: 'json' | 'empty' = 'json',
  ): Promise<ApiResult> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const authentication = await authenticate(signal)
      const headers: Record<string, string> = {
        authorization: `Bearer ${authentication.token}`,
      }
      if (body !== undefined) headers['content-type'] = 'application/json'
      const requestInit: RequestInit = {
        method,
        headers,
        signal,
      }
      if (body !== undefined) requestInit.body = JSON.stringify(body)
      const response = await fetchApi(`${baseUrl}${path}`, requestInit, operation)
      if (response.status === 401 && attempt === 0) {
        await response.text()
        cachedAuthentication = undefined
        continue
      }
      if (expected === 'empty') {
        await responseEmpty(response, operation)
        return { value: null, user: authentication }
      }
      return { value: await responseJson(response, operation), user: authentication }
    }
    throw new MemoryApiError(`${operation}：重新认证后仍未获得接口响应`)
  }

  async function ownedJson(
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body: JsonObject | undefined,
    signal: AbortSignal,
    operation: string,
  ): Promise<JsonValue> {
    const result = await request(method, path, body, signal, operation)
    if (result.value === null) throw new MemoryApiError(`${operation}：接口意外返回空结果`)
    assertOwnedResponse(result.value, result.user, operation)
    return result.value
  }

  async function remove(
    path: string,
    id: number,
    signal: AbortSignal,
    operation: string,
  ): Promise<JsonValue> {
    const result = await request('DELETE', path, undefined, signal, operation, 'empty')
    return {
      deleted: true,
      id,
      user_id: result.user.id,
      username: result.user.username,
    }
  }

  ctx.tools.register(defineTool({
    name: 'user_memory_list',
    description: `查询当前认证用户的 User Memory。${USER_MEMORY_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100。' },
      search: { type: 'string', description: '匹配 key 或 content 的关键词。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET',
      `/memory/user-memories${queryString({
        page: args.page,
        page_size: args.page_size,
        search: args.search,
      })}`,
      undefined,
      exec.signal,
      'user_memory_list',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'user_memory_get',
    description: `按记录 ID 查询当前认证用户的一条 User Memory。${USER_MEMORY_DESCRIPTION}`,
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'User Memory 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET', `/memory/user-memories/${args.memory_id}`, undefined, exec.signal, 'user_memory_get',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'user_memory_create',
    description: `为当前认证用户创建 User Memory。仅在用户明确要求记住稳定偏好或事实时调用。${USER_MEMORY_DESCRIPTION}`,
    parameters: {
      key: { type: 'string', required: true, description: '当前用户下唯一的记忆键。' },
      content: { type: 'string', required: true, description: '要保存的稳定偏好或事实。' },
      metadata: { type: 'object', additionalProperties: true, description: '可选结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'POST',
      '/memory/user-memories',
      jsonBody({ key: args.key, content: args.content, metadata: args.metadata }),
      exec.signal,
      'user_memory_create',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'user_memory_update',
    description: `修改当前认证用户已有的 User Memory。${USER_MEMORY_DESCRIPTION}`,
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'User Memory 记录 ID。' },
      key: { type: 'string', description: '新的记忆键。' },
      content: { type: 'string', description: '新的记忆内容。' },
      metadata: { type: 'object', additionalProperties: true, description: '新的结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => {
      return ownedJson(
        'PATCH',
        `/memory/user-memories/${args.memory_id}`,
        requireUpdateBody(jsonBody({
          key: args.key,
          content: args.content,
          metadata: args.metadata,
        }), 'user_memory_update'),
        exec.signal,
        'user_memory_update',
      )
    },
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'user_memory_delete',
    description: '删除当前认证用户的一条 User Memory。仅在用户明确要求遗忘时调用。',
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'User Memory 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => remove(
      `/memory/user-memories/${args.memory_id}`,
      args.memory_id,
      exec.signal,
      'user_memory_delete',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_list',
    description: `查询当前认证用户的 Project Memory。${PROJECT_MEMORY_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100。' },
      project_id: { type: 'string', description: '项目唯一标识。' },
      search: { type: 'string', description: '匹配 key 或 content 的关键词。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET',
      `/memory/project-memories${queryString({
        page: args.page,
        page_size: args.page_size,
        project_id: args.project_id,
        search: args.search,
      })}`,
      undefined,
      exec.signal,
      'project_memory_list',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_get',
    description: `按记录 ID 查询当前认证用户的一条 Project Memory。${PROJECT_MEMORY_DESCRIPTION}`,
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'Project Memory 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET',
      `/memory/project-memories/${args.memory_id}`,
      undefined,
      exec.signal,
      'project_memory_get',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_create',
    description: `为当前认证用户创建 Project Memory。仅保存指定项目内的稳定约定、决策或上下文。${PROJECT_MEMORY_DESCRIPTION}`,
    parameters: {
      project_id: { type: 'string', required: true, description: '项目唯一标识。' },
      key: { type: 'string', required: true, description: '当前用户和项目下唯一的记忆键。' },
      content: { type: 'string', required: true, description: '项目约定、决策或上下文。' },
      metadata: { type: 'object', additionalProperties: true, description: '可选结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'POST',
      '/memory/project-memories',
      jsonBody({
        project_id: args.project_id,
        key: args.key,
        content: args.content,
        metadata: args.metadata,
      }),
      exec.signal,
      'project_memory_create',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_update',
    description: `修改当前认证用户已有的 Project Memory。${PROJECT_MEMORY_DESCRIPTION}`,
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'Project Memory 记录 ID。' },
      project_id: { type: 'string', description: '新的项目唯一标识。' },
      key: { type: 'string', description: '新的记忆键。' },
      content: { type: 'string', description: '新的项目记忆内容。' },
      metadata: { type: 'object', additionalProperties: true, description: '新的结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => {
      return ownedJson(
        'PATCH',
        `/memory/project-memories/${args.memory_id}`,
        requireUpdateBody(jsonBody({
          project_id: args.project_id,
          key: args.key,
          content: args.content,
          metadata: args.metadata,
        }), 'project_memory_update'),
        exec.signal,
        'project_memory_update',
      )
    },
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'project_memory_delete',
    description: '删除当前认证用户的一条 Project Memory。仅在用户明确要求遗忘项目记忆时调用。',
    parameters: {
      memory_id: { type: 'integer', required: true, description: 'Project Memory 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => remove(
      `/memory/project-memories/${args.memory_id}`,
      args.memory_id,
      exec.signal,
      'project_memory_delete',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'task_history_list',
    description: `查询当前认证用户的 Task History。${TASK_HISTORY_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100。' },
      project_id: { type: 'string', description: '项目唯一标识。' },
      session_id: { type: 'string', description: 'Harness 会话标识。' },
      status: { type: 'string', enum: [...TASK_STATUSES], description: '任务状态。' },
      search: { type: 'string', description: '匹配 task_id、标题、输入或输出的关键词。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET',
      `/memory/task-history${queryString({
        page: args.page,
        page_size: args.page_size,
        project_id: args.project_id,
        session_id: args.session_id,
        status: args.status,
        search: args.search,
      })}`,
      undefined,
      exec.signal,
      'task_history_list',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'task_history_get',
    description: `按记录 ID 查询当前认证用户的一条 Task History。${TASK_HISTORY_DESCRIPTION}`,
    parameters: {
      history_id: { type: 'integer', required: true, description: 'Task History 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => ownedJson(
      'GET', `/memory/task-history/${args.history_id}`, undefined, exec.signal, 'task_history_get',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'task_history_create',
    description: `为当前认证用户创建 Task History。未提供 session_id 时使用当前 Harness Agent/Session ID。${TASK_HISTORY_DESCRIPTION}`,
    parameters: {
      task_id: { type: 'string', required: true, description: '当前用户下唯一的任务标识。' },
      title: { type: 'string', required: true, description: '任务标题。' },
      task_input: { type: 'string', required: true, description: '任务输入或目标。' },
      project_id: { type: 'string', description: '关联项目标识。' },
      session_id: { type: 'string', description: '关联会话标识；省略时自动使用当前会话。' },
      task_output: { type: 'string', description: '任务输出或结果。' },
      status: { type: 'string', enum: [...TASK_STATUSES], description: '任务状态。' },
      started_at: { type: 'string', description: 'ISO 8601 开始时间。' },
      completed_at: { type: 'string', description: 'ISO 8601 完成时间。' },
      metadata: { type: 'object', additionalProperties: true, description: '可选结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => {
      const sessionId = args.session_id ?? (exec.agent === undefined ? undefined : String(exec.agent.id))
      return ownedJson(
        'POST',
        '/memory/task-history',
        jsonBody({
          task_id: args.task_id,
          project_id: args.project_id,
          session_id: sessionId,
          title: args.title,
          task_input: args.task_input,
          task_output: args.task_output,
          status: args.status,
          started_at: args.started_at,
          completed_at: args.completed_at,
          metadata: args.metadata,
        }),
        exec.signal,
        'task_history_create',
      )
    },
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'task_history_update',
    description: `修改当前认证用户已有的 Task History，包括执行状态和输出。${TASK_HISTORY_DESCRIPTION}`,
    parameters: {
      history_id: { type: 'integer', required: true, description: 'Task History 记录 ID。' },
      task_id: { type: 'string', description: '新的任务标识。' },
      project_id: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: '新的项目标识；null 表示清空。',
      },
      session_id: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: '新的会话标识；null 表示清空。',
      },
      title: { type: 'string', description: '新的任务标题。' },
      task_input: { type: 'string', description: '新的任务输入。' },
      task_output: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: '新的任务输出；null 表示清空。',
      },
      status: { type: 'string', enum: [...TASK_STATUSES], description: '新的任务状态。' },
      started_at: { type: 'string', description: '新的 ISO 8601 开始时间。' },
      completed_at: {
        oneOf: [{ type: 'string' }, { type: 'null' }],
        description: '新的 ISO 8601 完成时间；null 表示清空。',
      },
      metadata: { type: 'object', additionalProperties: true, description: '新的结构化元数据。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => {
      return ownedJson(
        'PATCH',
        `/memory/task-history/${args.history_id}`,
        requireUpdateBody(jsonBody({
          task_id: args.task_id,
          project_id: args.project_id,
          session_id: args.session_id,
          title: args.title,
          task_input: args.task_input,
          task_output: args.task_output,
          status: args.status,
          started_at: args.started_at,
          completed_at: args.completed_at,
          metadata: args.metadata,
        }), 'task_history_update'),
        exec.signal,
        'task_history_update',
      )
    },
    finalizeContent: finalizeMemoryFailure,
  }))

  ctx.tools.register(defineTool({
    name: 'task_history_delete',
    description: '删除当前认证用户的一条 Task History。仅在用户明确要求删除历史时调用。',
    parameters: {
      history_id: { type: 'integer', required: true, description: 'Task History 记录 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => remove(
      `/memory/task-history/${args.history_id}`,
      args.history_id,
      exec.signal,
      'task_history_delete',
    ),
    finalizeContent: finalizeMemoryFailure,
  }))
}

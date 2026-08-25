/**
 * Atomic read-only security-data tools backed by the local network-security API.
 * @module security-atomic
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-system-prompt'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/api/v1'
const TOKEN_REFRESH_MARGIN_MS = 30_000
const MAX_ERROR_DETAIL_LENGTH = 300

const ATOMIC_SECURITY_RULES = `## 安全数据原子工具规则

- 本插件的每个业务工具只查询一种实体和一个接口，不执行跨资产、漏洞、安全事件的聚合、统计或风险打分。
- 用户的问题涉及多种实体时，必须主动规划并连续调用所需工具：先取得关联 ID，再查询其他实体，直到问题要求的维度均已验证。不得因为一次工具调用成功就省略仍然需要的后续查询。
- 对资产逐项检查漏洞或事件时，先用 security_asset_list 得到资产 ID，再对每项相关资产分别调用 security_vulnerability_list 和/或 security_event_list，并传入 asset_id。取得漏洞或事件中的 asset_ids 后，需要资产详情时再调用 security_asset_get。
- 分页响应的 total 超出当前页范围，且用户要求完整清单、完整统计或全量判断时，必须继续翻页；不得把单页结果当作全量结果。
- 当前资产、漏洞、事件、数量、状态和关联关系只能以本轮成功返回的接口数据为准。不得使用会话记忆、历史工具结果、模型知识或猜测替代实时查询。
- 工具成功返回空列表是有效结果，应如实说明没有匹配数据。多个调用只成功一部分时，只能使用成功部分，并明确列出未验证的部分。`

const REALTIME_TOOL_DESCRIPTION =
  '这是只读原子查询；涉及当前业务数据时必须调用本工具并以本次返回为准，不得使用会话记忆或先前结果代替。'

const REALTIME_FAILURE_INSTRUCTION =
  '本次没有获得可验证的实时数据。必须明确告知用户安全数据接口调用失败及上述原因；不得使用会话记忆、历史工具结果或模型知识补齐答案。'

const ASSET_TYPES = [
  'server',
  'network_device',
  'database',
  'cloud',
  'container',
  'application',
  'endpoint',
  'other',
] as const

const CRITICALITIES = ['critical', 'high', 'medium', 'low'] as const
const ASSET_STATUSES = ['active', 'offline', 'retired'] as const
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const
const WORKFLOW_STATUSES = ['no_response', 'responding', 'closed'] as const

/** Cordis plugin name. */
export const name = 'security-atomic'

/** Services required before the plugin registers its tools. */
export const inject = ['tools', 'systemPrompt']

/** Security API connection settings. */
export interface Config {
  /** Security API base URL including `/api/v1`. */
  baseUrl: string
  /** Username used to obtain a Bearer token. */
  username: string
  /** Password used to obtain a Bearer token. */
  password: string
  /** Cooperative timeout applied to every atomic tool call. */
  timeoutMs: number
}

/** Security-atomic plugin configuration schema. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  username: z.string().required(),
  password: z.string().role('secret').required(),
  timeoutMs: z.number().step(1).min(1).default(15_000),
})

interface CachedToken {
  value: string
  expiresAtMs: number
}

type JsonObject = { [key: string]: JsonValue }
type QueryValue = string | number | undefined

class SecurityAtomicApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`security-atomic: ${message}`, options)
    this.name = 'SecurityAtomicApiError'
  }
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredObject(value: JsonValue, operation: string): JsonObject {
  if (!isJsonObject(value)) {
    throw new SecurityAtomicApiError(`${operation}：接口响应必须是对象`)
  }
  return value
}

function requiredNonNegativeInteger(value: JsonValue | undefined, field: string, operation: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new SecurityAtomicApiError(`${operation}：接口分页响应字段 ${field} 必须是非负整数`)
  }
}

function requiredPositiveInteger(value: JsonValue | undefined, field: string, operation: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new SecurityAtomicApiError(`${operation}：接口分页响应字段 ${field} 必须是正整数`)
  }
}

function requiredPage(value: JsonValue, operation: string): JsonObject {
  const page = requiredObject(value, operation)
  const items = page['items']
  if (!Array.isArray(items)) {
    throw new SecurityAtomicApiError(`${operation}：接口分页响应字段 items 必须是数组`)
  }
  items.forEach((item, index) => requiredObject(item, `${operation}: items[${index}]`))
  requiredNonNegativeInteger(page['total'], 'total', operation)
  requiredPositiveInteger(page['page'], 'page', operation)
  requiredPositiveInteger(page['page_size'], 'page_size', operation)
  return page
}

function assetOnly(value: JsonValue, operation: string): JsonObject {
  const asset = requiredObject(value, operation)
  const {
    vulnerabilities: _vulnerabilities,
    security_events: _securityEvents,
    ...atomicAsset
  } = asset
  return atomicAsset
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
    // Non-JSON error bodies are still useful diagnostics after length limiting.
  }
  return compactErrorDetail(text)
}

function httpFailure(
  operation: string,
  response: Response,
  text: string,
): SecurityAtomicApiError {
  const summary = response.status === 400
    ? '请求参数被接口拒绝'
    : response.status === 401
      ? '认证失败或登录已过期'
      : response.status === 403
        ? '当前账号无权访问'
        : response.status === 404
          ? '请求的资源不存在'
          : response.status === 408
            ? '接口请求超时'
            : response.status === 409
              ? '接口数据发生冲突'
              : response.status === 422
                ? '接口参数校验失败'
                : response.status === 429
                  ? '接口请求过于频繁'
                  : response.status >= 500
                    ? '安全数据服务端异常'
                    : '接口返回非成功状态'
  const detail = errorResponseDetail(text)
  const suffix = detail === undefined ? '' : `：${detail}`
  return new SecurityAtomicApiError(
    `${operation}：${summary}（HTTP ${response.status}）${suffix}`,
  )
}

async function fetchApi(
  input: string,
  init: RequestInit,
  operation: string,
): Promise<Response> {
  try {
    return await fetch(input, init)
  } catch (cause) {
    if (init.signal?.aborted) {
      throw new SecurityAtomicApiError(`${operation}：请求已取消或超时`, { cause })
    }
    throw new SecurityAtomicApiError(
      `${operation}：无法连接安全数据服务，请检查服务状态、地址和网络`,
      { cause },
    )
  }
}

async function responseJson(response: Response, operation: string): Promise<JsonValue> {
  const text = await response.text()
  if (!response.ok) throw httpFailure(operation, response, text)
  if (text === '') {
    throw new SecurityAtomicApiError(`${operation}：接口成功响应缺少 JSON 内容`)
  }

  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch (cause) {
    throw new SecurityAtomicApiError(`${operation}：接口成功响应不是有效 JSON`, { cause })
  }

  const value = snapshotJsonValue(candidate)
  if (value === undefined) {
    throw new SecurityAtomicApiError(`${operation}：接口响应包含不受支持的 JSON 值`)
  }
  return value as JsonValue
}

function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: JsonValue) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
}

function finalizeRealtimeFailure(
  _exec: unknown,
  result: { isError: boolean, error?: { message: string, info?: { code: string } } },
) {
  if (!result.isError || result.error === undefined) return undefined
  if (result.error.info?.code === 'INVALID_ARGS') return undefined
  const isRealtimeFailure = result.error.message.startsWith('security-atomic:')
    || result.error.info?.code === 'TOOL_TIMEOUT'
    || result.error.info?.code === 'ABORTED'
  if (!isRealtimeFailure) return undefined
  return [{
    type: 'text' as const,
    text: `安全实时数据获取失败：${result.error.message}\n\n${REALTIME_FAILURE_INSTRUCTION}`,
  }]
}

function querySuffix(args: Readonly<Record<string, QueryValue>>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(args)) {
    if (value !== undefined) query.set(key, String(value))
  }
  return query.size === 0 ? '' : `?${query.toString()}`
}

/**
 * Register atomic, read-only asset, vulnerability, and security-event tools.
 * @param ctx - Plugin context providing the tool registry.
 * @param config - Security API endpoint, credentials, and timeout.
 */
export function apply(ctx: Context, config: Config): void {
  const configuredUrl = new URL(config.baseUrl)
  if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
    throw new Error('security-atomic: baseUrl must use HTTP or HTTPS')
  }
  if (configuredUrl.search !== '' || configuredUrl.hash !== '') {
    throw new Error('security-atomic: baseUrl must not contain a query or fragment')
  }
  if (configuredUrl.username !== '' || configuredUrl.password !== '') {
    throw new Error('security-atomic: baseUrl must not contain credentials')
  }
  if (config.username.trim() === '') {
    throw new Error('security-atomic: username must not be empty')
  }
  if (config.password === '') {
    throw new Error('security-atomic: password must not be empty')
  }

  ctx.systemPrompt.section({
    name: 'tool:security-atomic-loop-rules',
    order: 160,
    text: ATOMIC_SECURITY_RULES,
  })

  const baseUrl = configuredUrl.toString().replace(/\/$/, '')
  let cachedToken: CachedToken | undefined

  async function login(signal: AbortSignal): Promise<string> {
    if (cachedToken !== undefined && Date.now() + TOKEN_REFRESH_MARGIN_MS < cachedToken.expiresAtMs) {
      return cachedToken.value
    }

    const operation = 'security-atomic login'
    const response = await fetchApi(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
      signal,
    }, operation)
    const value = await responseJson(response, operation)
    if (
      !isJsonObject(value)
      || typeof value['access_token'] !== 'string'
      || typeof value['expires_at'] !== 'number'
      || !Number.isFinite(value['expires_at'])
    ) {
      throw new SecurityAtomicApiError(
        `${operation}：登录响应必须包含 access_token 和 expires_at`,
      )
    }

    cachedToken = {
      value: value['access_token'],
      expiresAtMs: value['expires_at'] * 1000,
    }
    return cachedToken.value
  }

  async function get(path: string, signal: AbortSignal, operation: string): Promise<JsonValue> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const token = await login(signal)
      const response = await fetchApi(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      }, operation)
      if (response.status === 401 && attempt === 0) {
        await response.text()
        cachedToken = undefined
        continue
      }
      return responseJson(response, operation)
    }
    throw new SecurityAtomicApiError(`${operation}：重新认证后仍未获得接口响应`)
  }

  ctx.tools.register(defineTool({
    name: 'security_asset_list',
    description: `分页查询或筛选资产；只返回资产，不查询关联漏洞或安全事件。复杂问题应先用本工具取得 asset_id，再调用对应实体工具。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始；省略时为 1。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100；省略时为 20。' },
      search: { type: 'string', description: '匹配资产编码、名称、IP 地址或主机名的关键词。' },
      asset_type: { type: 'string', enum: [...ASSET_TYPES], description: '资产类型。' },
      criticality: { type: 'string', enum: [...CRITICALITIES], description: '业务重要程度。' },
      status: { type: 'string', enum: [...ASSET_STATUSES], description: '资产状态。' },
      owner_id: { type: 'integer', description: '责任人用户 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_asset_list'
      return requiredPage(
        await get(`/assets${querySuffix(args)}`, exec.signal, operation),
        operation,
      )
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: args.search === undefined ? '原子查询资产列表' : `原子查找资产：${args.search}`,
      kind: 'search',
      rawInput: args.search ?? args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'security_asset_get',
    description: `按数字 ID 查询单项资产详情。返回值会移除接口内嵌的 vulnerabilities 和 security_events；关联数据必须分别调用漏洞或事件列表工具查询。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      asset_id: { type: 'integer', required: true, description: '要查询的资产数字 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_asset_get'
      return assetOnly(await get(`/assets/${args.asset_id}`, exec.signal, operation), operation)
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: `原子查询资产 ${args.asset_id}`,
      kind: 'read',
      rawInput: args.asset_id,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'security_vulnerability_list',
    description: `分页查询或筛选漏洞；只返回漏洞实体。按资产检查漏洞时必须传入 asset_id，并按需继续翻页。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始；省略时为 1。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100；省略时为 20。' },
      search: { type: 'string', description: '匹配漏洞编号、名称或 CVE 的关键词。' },
      severity: { type: 'string', enum: [...SEVERITIES], description: '漏洞严重度。' },
      status: { type: 'string', enum: [...WORKFLOW_STATUSES], description: '漏洞处置状态。' },
      asset_id: { type: 'integer', description: '只返回关联到该资产 ID 的漏洞。' },
      assignee_id: { type: 'integer', description: '处置人用户 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_vulnerability_list'
      return requiredPage(
        await get(`/vulnerabilities${querySuffix(args)}`, exec.signal, operation),
        operation,
      )
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: args.asset_id === undefined
        ? '原子查询漏洞列表'
        : `查询资产 ${args.asset_id} 的漏洞`,
      kind: 'search',
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'security_vulnerability_get',
    description: `按数字 ID 查询单项漏洞详情；不继续查询 asset_ids 指向的资产。需要资产详情时，再逐项调用 security_asset_get。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      vulnerability_id: { type: 'integer', required: true, description: '要查询的漏洞数字 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_vulnerability_get'
      return requiredObject(
        await get(`/vulnerabilities/${args.vulnerability_id}`, exec.signal, operation),
        operation,
      )
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: `原子查询漏洞 ${args.vulnerability_id}`,
      kind: 'read',
      rawInput: args.vulnerability_id,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'security_event_list',
    description: `分页查询或筛选安全事件；只返回安全事件实体。按资产检查事件时必须传入 asset_id，并按需继续翻页。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始；省略时为 1。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100；省略时为 20。' },
      search: { type: 'string', description: '匹配事件编号、标题、源 IP 或目标 IP 的关键词。' },
      severity: { type: 'string', enum: [...SEVERITIES], description: '事件严重度。' },
      status: { type: 'string', enum: [...WORKFLOW_STATUSES], description: '事件处置状态。' },
      category: { type: 'string', description: '安全事件分类。' },
      asset_id: { type: 'integer', description: '只返回关联到该资产 ID 的安全事件。' },
      assignee_id: { type: 'integer', description: '处置人用户 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_event_list'
      return requiredPage(
        await get(`/security-events${querySuffix(args)}`, exec.signal, operation),
        operation,
      )
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: args.asset_id === undefined
        ? '原子查询安全事件列表'
        : `查询资产 ${args.asset_id} 的安全事件`,
      kind: 'search',
      rawInput: args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'security_event_get',
    description: `按数字 ID 查询单项安全事件详情；不继续查询 asset_ids 指向的资产。需要资产详情时，再逐项调用 security_asset_get。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      event_id: { type: 'integer', required: true, description: '要查询的安全事件数字 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const operation = 'security_event_get'
      return requiredObject(
        await get(`/security-events/${args.event_id}`, exec.signal, operation),
        operation,
      )
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: `原子查询安全事件 ${args.event_id}`,
      kind: 'read',
      rawInput: args.event_id,
    }),
  }))
}

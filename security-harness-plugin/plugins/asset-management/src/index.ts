/**
 * Read-only asset-management tools backed by the local network-security API.
 * @module asset-management
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import '@deepseek-ai/dsh-system-prompt'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/api/v1'
const TOKEN_REFRESH_MARGIN_MS = 30_000
const MAX_ERROR_DETAIL_LENGTH = 300

const ASSET_DATA_GROUNDING_RULES = `## 资产管理实时数据规则

- 用户询问当前资产清单、详情、数量、状态、责任人、漏洞、安全事件、统计或风险结论时，必须调用本插件的工具，以本轮成功返回的接口数据为唯一事实来源。
- 会话记忆仅可用于理解用户意图、沿用筛选条件或用户明确提供的 ID/名称，以及回答不依赖当前业务数据的通用概念。用户明确要求回顾先前结果时，可以复述，但必须标明它是历史结果而非实时状态。
- 不得用会话记忆、先前工具结果、模型知识或猜测替代本轮实时查询。后续问题只要要求当前状态、重新统计或风险判断，就必须重新调用接口。
- 工具返回空列表是一次有效的实时结果，应如实说明没有匹配数据，不得从记忆补齐。
- 参数错误应先修正参数并重试；认证、权限、HTTP、网络、超时或响应格式错误时，必须明确告诉用户资产接口调用失败及简要原因，不得继续给出未经本轮接口验证的业务结论。
- 多个接口只成功一部分时，只能使用成功部分，并明确列出未验证的部分；不得根据已成功的数据推断失败部分。`

const REALTIME_TOOL_DESCRIPTION =
  '涉及当前业务数据时必须调用本工具并以本次返回为准；不得使用会话记忆或先前结果代替实时查询。'

const REALTIME_FAILURE_INSTRUCTION =
  '本次没有获得可验证的实时数据。必须明确告知用户资产接口调用失败及上述原因；不得使用会话记忆、历史工具结果或模型知识补齐答案。'

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
const EXPOSURES = ['internet', 'intranet', 'isolated'] as const
const RELEVANT_SEVERITIES = ['critical', 'high'] as const
const WORKFLOW_STATUSES = ['no_response', 'responding', 'closed'] as const

/** Cordis plugin name. */
export const name = 'asset-management'

/** Services required before the plugin registers its tools. */
export const inject = ['tools', 'systemPrompt']

/** Asset API connection settings. */
export interface Config {
  /** Asset API base URL including `/api/v1`. */
  baseUrl: string
  /** Username used to obtain a Bearer token. */
  username: string
  /** Password used to obtain a Bearer token. */
  password: string
  /** Cooperative timeout applied to every asset tool call. */
  timeoutMs: number
  /** Score contributed by a critical asset. */
  criticalAssetWeight: number
  /** Score contributed by a high-importance asset. */
  highAssetWeight: number
  /** Score contributed by internet exposure. */
  internetExposureWeight: number
  /** Score contributed by intranet exposure. */
  intranetExposureWeight: number
  /** Score contributed when an asset has no owner. */
  unownedAssetWeight: number
  /** Score contributed by each unresolved critical vulnerability or event. */
  criticalFindingWeight: number
  /** Score contributed by each unresolved high vulnerability or event. */
  highFindingWeight: number
  /** Additional score for each finding whose status is `no_response`. */
  noResponseWeight: number
  /** Minimum score classified as high risk. */
  highRiskScore: number
  /** Minimum score classified as critical risk. */
  criticalRiskScore: number
}

/** Asset-management plugin configuration schema. */
export const Config: z<Config> = z.object({
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  username: z.string().required(),
  password: z.string().role('secret').required(),
  timeoutMs: z.number().step(1).min(1).default(15_000),
  criticalAssetWeight: z.number().min(0).default(3),
  highAssetWeight: z.number().min(0).default(2),
  internetExposureWeight: z.number().min(0).default(2),
  intranetExposureWeight: z.number().min(0).default(1),
  unownedAssetWeight: z.number().min(0).default(1),
  criticalFindingWeight: z.number().min(0).default(4),
  highFindingWeight: z.number().min(0).default(2),
  noResponseWeight: z.number().min(0).default(1),
  highRiskScore: z.number().min(0).default(7),
  criticalRiskScore: z.number().min(0).default(12),
})

interface CachedToken {
  value: string
  expiresAtMs: number
}

type JsonObject = { [key: string]: JsonValue }
type KeyCriticality = typeof RELEVANT_SEVERITIES[number]
type RelevantSeverity = typeof RELEVANT_SEVERITIES[number]
type WorkflowStatus = typeof WORKFLOW_STATUSES[number]

interface KeyAsset {
  id: number
  assetCode: string
  name: string
  criticality: KeyCriticality
  exposure: typeof EXPOSURES[number]
  status: typeof ASSET_STATUSES[number]
  ownerId: number | null
}

interface Finding {
  id: number
  code: string
  title: string
  severity: RelevantSeverity
  status: WorkflowStatus
}

function isJsonObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredObject(value: JsonValue, operation: string): JsonObject {
  if (!isJsonObject(value)) throw new AssetApiError(`${operation}：接口响应必须是对象`)
  return value
}

function requiredString(record: JsonObject, key: string, operation: string): string {
  const value = record[key]
  if (typeof value !== 'string') {
    throw new AssetApiError(`${operation}：接口响应字段 ${key} 必须是字符串`)
  }
  return value
}

function requiredInteger(record: JsonObject, key: string, operation: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AssetApiError(`${operation}：接口响应字段 ${key} 必须是整数`)
  }
  return value
}

function requiredEnum<const T extends readonly string[]>(
  record: JsonObject,
  key: string,
  values: T,
  operation: string,
): T[number] {
  const value = requiredString(record, key, operation)
  if (!(values as readonly string[]).includes(value)) {
    throw new AssetApiError(
      `${operation}：接口响应字段 ${key} 包含不支持的值 ${JSON.stringify(value)}`,
    )
  }
  return value as T[number]
}

function pageItems(value: JsonValue, operation: string): { items: JsonObject[], total: number } {
  const page = requiredObject(value, operation)
  const items = page['items']
  const total = page['total']
  if (!Array.isArray(items)) {
    throw new AssetApiError(`${operation}：接口分页响应字段 items 必须是数组`)
  }
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new AssetApiError(`${operation}：接口分页响应字段 total 必须是非负整数`)
  }
  return {
    items: items.map((item, index) => requiredObject(item, `${operation}: items[${index}]`)),
    total,
  }
}

function keyAsset(record: JsonObject, operation: string): KeyAsset {
  const ownerId = record['owner_id']
  if (ownerId !== null && (typeof ownerId !== 'number' || !Number.isInteger(ownerId))) {
    throw new AssetApiError(`${operation}：接口响应字段 owner_id 必须是整数或 null`)
  }
  return {
    id: requiredInteger(record, 'id', operation),
    assetCode: requiredString(record, 'asset_code', operation),
    name: requiredString(record, 'name', operation),
    criticality: requiredEnum(record, 'criticality', RELEVANT_SEVERITIES, operation),
    exposure: requiredEnum(record, 'exposure', EXPOSURES, operation),
    status: requiredEnum(record, 'status', ASSET_STATUSES, operation),
    ownerId,
  }
}

function finding(record: JsonObject, kind: 'vulnerability' | 'event', operation: string): Finding {
  return {
    id: requiredInteger(record, 'id', operation),
    code: requiredString(record, kind === 'vulnerability' ? 'vuln_code' : 'event_code', operation),
    title: requiredString(record, kind === 'vulnerability' ? 'name' : 'title', operation),
    severity: requiredEnum(record, 'severity', RELEVANT_SEVERITIES, operation),
    status: requiredEnum(record, 'status', WORKFLOW_STATUSES, operation),
  }
}

function summarizeFindings(findings: Finding[], config: Config) {
  const unresolved = findings.filter(item => item.status !== 'closed')
  const unresolvedCritical = unresolved.filter(item => item.severity === 'critical').length
  const unresolvedHigh = unresolved.filter(item => item.severity === 'high').length
  const noResponse = unresolved.filter(item => item.status === 'no_response').length
  return {
    total: findings.length,
    critical: findings.filter(item => item.severity === 'critical').length,
    high: findings.filter(item => item.severity === 'high').length,
    unresolved: unresolved.length,
    unresolved_critical: unresolvedCritical,
    unresolved_high: unresolvedHigh,
    no_response: noResponse,
    responding: unresolved.filter(item => item.status === 'responding').length,
    closed: findings.filter(item => item.status === 'closed').length,
    score:
      unresolvedCritical * config.criticalFindingWeight
      + unresolvedHigh * config.highFindingWeight
      + noResponse * config.noResponseWeight,
    items: findings.map(item => ({
      id: item.id,
      code: item.code,
      title: item.title,
      severity: item.severity,
      status: item.status,
    })),
  }
}

class AssetApiError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(`asset-management: ${message}`, options)
    this.name = 'AssetApiError'
  }
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

function httpFailure(operation: string, response: Response, text: string): AssetApiError {
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
                    ? '资产服务端异常'
                    : '接口返回非成功状态'
  const detail = errorResponseDetail(text)
  const suffix = detail === undefined ? '' : `：${detail}`
  return new AssetApiError(`${operation}：${summary}（HTTP ${response.status}）${suffix}`)
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
      throw new AssetApiError(`${operation}：请求已取消或超时`, { cause })
    }
    throw new AssetApiError(`${operation}：无法连接资产服务，请检查服务状态、地址和网络`, { cause })
  }
}

async function responseJson(response: Response, operation: string): Promise<JsonValue> {
  const text = await response.text()
  if (!response.ok) throw httpFailure(operation, response, text)
  if (text === '') throw new AssetApiError(`${operation}：接口成功响应缺少 JSON 内容`)

  let candidate: unknown
  try {
    candidate = JSON.parse(text)
  } catch (cause) {
    throw new AssetApiError(`${operation}：接口成功响应不是有效 JSON`, { cause })
  }

  const value = snapshotJsonValue(candidate)
  if (value === undefined) {
    throw new AssetApiError(`${operation}：接口响应包含不受支持的 JSON 值`)
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
  const isRealtimeFailure = result.error.message.startsWith('asset-management:')
    || result.error.info?.code === 'TOOL_TIMEOUT'
    || result.error.info?.code === 'ABORTED'
  if (!isRealtimeFailure) return undefined
  return [{
    type: 'text' as const,
    text: `资产实时数据获取失败：${result.error.message}\n\n${REALTIME_FAILURE_INSTRUCTION}`,
  }]
}

/**
 * Register read-only asset query and statistics tools.
 * @param ctx - Plugin context providing the tool registry.
 * @param config - Asset API endpoint, credentials, and timeout.
 */
export function apply(ctx: Context, config: Config): void {
  const configuredUrl = new URL(config.baseUrl)
  if (configuredUrl.protocol !== 'http:' && configuredUrl.protocol !== 'https:') {
    throw new Error('asset-management: baseUrl must use HTTP or HTTPS')
  }
  if (configuredUrl.search !== '' || configuredUrl.hash !== '') {
    throw new Error('asset-management: baseUrl must not contain a query or fragment')
  }
  if (configuredUrl.username !== '' || configuredUrl.password !== '') {
    throw new Error('asset-management: baseUrl must not contain credentials')
  }
  if (config.username.trim() === '') {
    throw new Error('asset-management: username must not be empty')
  }
  if (config.password === '') {
    throw new Error('asset-management: password must not be empty')
  }
  if (config.criticalRiskScore <= config.highRiskScore) {
    throw new Error('asset-management: criticalRiskScore must be greater than highRiskScore')
  }

  ctx.systemPrompt.section({
    name: 'tool:asset-management-data-grounding',
    order: 160,
    text: ASSET_DATA_GROUNDING_RULES,
  })

  const baseUrl = configuredUrl.toString().replace(/\/$/, '')
  let cachedToken: CachedToken | undefined

  async function login(signal: AbortSignal): Promise<string> {
    if (cachedToken !== undefined && Date.now() + TOKEN_REFRESH_MARGIN_MS < cachedToken.expiresAtMs) {
      return cachedToken.value
    }

    const operation = 'asset-management login'
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
      throw new AssetApiError(`${operation}：登录响应必须包含 access_token 和 expires_at`)
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

      const value = await responseJson(response, operation)
      return value
    }
    throw new AssetApiError(`${operation}：重新认证后仍未获得接口响应`)
  }

  async function getAll(
    path: string,
    filters: Readonly<Record<string, string | number>>,
    signal: AbortSignal,
    operation: string,
  ): Promise<JsonObject[]> {
    const collected: JsonObject[] = []
    let expectedTotal: number | undefined
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({ page: String(page), page_size: '100' })
      for (const [key, value] of Object.entries(filters)) query.set(key, String(value))
      const result = pageItems(
        await get(`${path}?${query.toString()}`, signal, operation),
        operation,
      )
      if (expectedTotal === undefined) expectedTotal = result.total
      if (result.total !== expectedTotal) {
        throw new AssetApiError(`${operation}：分页期间接口返回的 total 发生变化`)
      }
      collected.push(...result.items)
      if (collected.length >= expectedTotal) return collected.slice(0, expectedTotal)
      if (result.items.length === 0) {
        throw new AssetApiError(
          `${operation}：分页提前结束，未返回声明的全部 ${expectedTotal} 条记录`,
        )
      }
    }
  }

  ctx.tools.register(defineTool({
    name: 'asset_list',
    description: `查询或筛选网络安全资产列表。用户要求查找、盘点或统计匹配的资产时调用；search 可匹配资产编码、名称、IP 地址或主机名。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      page: { type: 'integer', description: '页码，从 1 开始。' },
      page_size: { type: 'integer', description: '每页数量，范围为 1 到 100。' },
      search: { type: 'string', description: '匹配资产编码、名称、IP 地址或主机名的关键词。' },
      asset_type: { type: 'string', enum: [...ASSET_TYPES], description: '资产类型。' },
      criticality: { type: 'string', enum: [...CRITICALITIES], description: '业务重要程度。' },
      status: { type: 'string', enum: [...ASSET_STATUSES], description: '资产状态。' },
      owner_id: { type: 'integer', description: '责任人用户 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const query = new URLSearchParams()
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) query.set(key, String(value))
      }
      const suffix = query.size === 0 ? '' : `?${query.toString()}`
      return get(`/assets${suffix}`, exec.signal, 'asset_list')
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: args.search === undefined ? '查询资产列表' : `查找资产：${args.search}`,
      kind: 'search',
      rawInput: args.search ?? args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_get',
    description: `按数字 ID 查询一项资产的完整详情，包括该资产关联的漏洞和安全事件。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      asset_id: { type: 'integer', required: true, description: '要查询的资产数字 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => get(`/assets/${args.asset_id}`, exec.signal, 'asset_get'),
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: `查询资产 ${args.asset_id}`,
      kind: 'read',
      rawInput: args.asset_id,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_ownership_statistics',
    description: `查询资产责任人覆盖情况，返回资产总数、有责任人数量和无责任人数量。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {},
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (_args, exec) => get(
      '/statistics/assets/ownership',
      exec.signal,
      'asset_ownership_statistics',
    ),
    finalizeContent: finalizeRealtimeFailure,
    presentCall: () => ({
      card: 'generic',
      title: '查询资产责任人覆盖情况',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_risk_overview',
    description: `查询全部资产的风险概览，返回漏洞和安全事件总数、处置状态统计以及每项资产的关联风险数量。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {},
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (_args, exec) => get(
      '/statistics/assets/risk-overview',
      exec.signal,
      'asset_risk_overview',
    ),
    finalizeContent: finalizeRealtimeFailure,
    presentCall: () => ({
      card: 'generic',
      title: '查询资产风险概览',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'assess_asset_risk',
    description: `执行重点资产风险评估。先筛选 critical/high 资产，再分别查询每项资产的 critical/high 漏洞和安全事件，综合资产重要度、暴露面、责任人、未闭环风险和未响应风险判断是否高风险。用户询问资产是否风险高、重点资产风险或要求多维风险研判时，优先调用本工具。${REALTIME_TOOL_DESCRIPTION}`,
    parameters: {
      search: {
        type: 'string',
        description: '可选资产关键词，匹配资产编码、名称、IP 地址或主机名；省略时评估全部重点资产。',
      },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    async execute(args, exec) {
      const commonFilters: Record<string, string | number> = {}
      if (args.search !== undefined) commonFilters['search'] = args.search
      const criticalAssets = await getAll(
        '/assets',
        { ...commonFilters, criticality: 'critical' },
        exec.signal,
        'assess_asset_risk critical assets',
      )
      const highAssets = await getAll(
        '/assets',
        { ...commonFilters, criticality: 'high' },
        exec.signal,
        'assess_asset_risk high assets',
      )
      const assets = [...criticalAssets, ...highAssets].map((record, index) => (
        keyAsset(record, `assess_asset_risk assets[${index}]`)
      ))

      const assessments = []
      for (const asset of assets) {
        const [criticalVulnerabilities, highVulnerabilities, criticalEvents, highEvents] = await Promise.all([
          getAll(
            '/vulnerabilities',
            { asset_id: asset.id, severity: 'critical' },
            exec.signal,
            `assess_asset_risk asset ${asset.id} critical vulnerabilities`,
          ),
          getAll(
            '/vulnerabilities',
            { asset_id: asset.id, severity: 'high' },
            exec.signal,
            `assess_asset_risk asset ${asset.id} high vulnerabilities`,
          ),
          getAll(
            '/security-events',
            { asset_id: asset.id, severity: 'critical' },
            exec.signal,
            `assess_asset_risk asset ${asset.id} critical events`,
          ),
          getAll(
            '/security-events',
            { asset_id: asset.id, severity: 'high' },
            exec.signal,
            `assess_asset_risk asset ${asset.id} high events`,
          ),
        ])

        const vulnerabilitySummary = summarizeFindings(
          [...criticalVulnerabilities, ...highVulnerabilities].map((record, index) => (
            finding(record, 'vulnerability', `assess_asset_risk asset ${asset.id} vulnerabilities[${index}]`)
          )),
          config,
        )
        const eventSummary = summarizeFindings(
          [...criticalEvents, ...highEvents].map((record, index) => (
            finding(record, 'event', `assess_asset_risk asset ${asset.id} events[${index}]`)
          )),
          config,
        )

        const assetImportanceScore = asset.criticality === 'critical'
          ? config.criticalAssetWeight
          : config.highAssetWeight
        const exposureScore = asset.exposure === 'internet'
          ? config.internetExposureWeight
          : asset.exposure === 'intranet'
            ? config.intranetExposureWeight
            : 0
        const ownershipScore = asset.ownerId === null ? config.unownedAssetWeight : 0
        const riskScore =
          assetImportanceScore
          + exposureScore
          + ownershipScore
          + vulnerabilitySummary.score
          + eventSummary.score
        const riskLevel = riskScore >= config.criticalRiskScore
          ? 'critical'
          : riskScore >= config.highRiskScore
            ? 'high'
            : 'not_high'
        const reasons = [
          `资产重要度为 ${asset.criticality}，贡献 ${assetImportanceScore} 分`,
          `暴露面为 ${asset.exposure}，贡献 ${exposureScore} 分`,
        ]
        if (asset.ownerId === null) reasons.push(`资产没有责任人，贡献 ${ownershipScore} 分`)
        if (vulnerabilitySummary.unresolved > 0) {
          reasons.push(
            `存在 ${vulnerabilitySummary.unresolved} 个未闭环高危及以上漏洞，贡献 ${vulnerabilitySummary.score} 分`,
          )
        }
        if (eventSummary.unresolved > 0) {
          reasons.push(
            `存在 ${eventSummary.unresolved} 个未闭环高危及以上事件，贡献 ${eventSummary.score} 分`,
          )
        }
        if (vulnerabilitySummary.unresolved === 0 && eventSummary.unresolved === 0) {
          reasons.push('没有未闭环的高危及以上漏洞或安全事件')
        }

        assessments.push({
          asset: {
            id: asset.id,
            asset_code: asset.assetCode,
            name: asset.name,
            criticality: asset.criticality,
            exposure: asset.exposure,
            status: asset.status,
            owner_id: asset.ownerId,
          },
          dimensions: {
            asset_importance_score: assetImportanceScore,
            exposure_score: exposureScore,
            ownership_score: ownershipScore,
            vulnerability_score: vulnerabilitySummary.score,
            security_event_score: eventSummary.score,
          },
          vulnerabilities: vulnerabilitySummary,
          security_events: eventSummary,
          risk_score: riskScore,
          risk_level: riskLevel,
          is_high_risk: riskLevel !== 'not_high',
          reasons,
        })
      }

      const criticalRiskCount = assessments.filter(item => item.risk_level === 'critical').length
      const highRiskCount = assessments.filter(item => item.risk_level === 'high').length
      return {
        query: { search: args.search ?? null },
        policy: {
          key_asset_criticalities: ['critical', 'high'],
          finding_severities: ['critical', 'high'],
          closed_findings_contribute_score: false,
          weights: {
            critical_asset: config.criticalAssetWeight,
            high_asset: config.highAssetWeight,
            internet_exposure: config.internetExposureWeight,
            intranet_exposure: config.intranetExposureWeight,
            unowned_asset: config.unownedAssetWeight,
            critical_finding: config.criticalFindingWeight,
            high_finding: config.highFindingWeight,
            no_response: config.noResponseWeight,
          },
          thresholds: {
            high: config.highRiskScore,
            critical: config.criticalRiskScore,
          },
        },
        summary: {
          key_asset_count: assessments.length,
          critical_risk_count: criticalRiskCount,
          high_risk_count: highRiskCount,
          is_high_risk: criticalRiskCount + highRiskCount > 0,
          overall_risk_level: criticalRiskCount > 0
            ? 'critical'
            : highRiskCount > 0
              ? 'high'
              : 'not_high',
        },
        assets: assessments,
      }
    },
    finalizeContent: finalizeRealtimeFailure,
    presentCall: args => ({
      card: 'generic',
      title: args.search === undefined ? '评估重点资产风险' : `评估资产风险：${args.search}`,
      kind: 'search',
      rawInput: args.search,
    }),
  }))
}

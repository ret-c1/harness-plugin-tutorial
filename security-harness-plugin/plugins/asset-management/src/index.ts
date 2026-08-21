/**
 * Read-only asset-management tools backed by the local network-security API.
 * @module asset-management
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { snapshotJsonValue } from '@deepseek-ai/dsh-session'
import { defineTool, type JsonValue } from '@deepseek-ai/dsh-tools'

const DEFAULT_BASE_URL = 'http://127.0.0.1:8000/api/v1'
const TOKEN_REFRESH_MARGIN_MS = 30_000

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
export const inject = ['tools']

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
  if (!isJsonObject(value)) throw new Error(`${operation}: API response must be an object`)
  return value
}

function requiredString(record: JsonObject, key: string, operation: string): string {
  const value = record[key]
  if (typeof value !== 'string') throw new Error(`${operation}: ${key} must be a string`)
  return value
}

function requiredInteger(record: JsonObject, key: string, operation: string): number {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${operation}: ${key} must be an integer`)
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
    throw new Error(`${operation}: ${key} has unsupported value ${JSON.stringify(value)}`)
  }
  return value as T[number]
}

function pageItems(value: JsonValue, operation: string): { items: JsonObject[], total: number } {
  const page = requiredObject(value, operation)
  const items = page['items']
  const total = page['total']
  if (!Array.isArray(items)) throw new Error(`${operation}: items must be an array`)
  if (typeof total !== 'number' || !Number.isInteger(total) || total < 0) {
    throw new Error(`${operation}: total must be a non-negative integer`)
  }
  return {
    items: items.map((item, index) => requiredObject(item, `${operation}: items[${index}]`)),
    total,
  }
}

function keyAsset(record: JsonObject, operation: string): KeyAsset {
  const ownerId = record['owner_id']
  if (ownerId !== null && (typeof ownerId !== 'number' || !Number.isInteger(ownerId))) {
    throw new Error(`${operation}: owner_id must be an integer or null`)
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

async function responseJson(response: Response, operation: string): Promise<JsonValue> {
  const text = await response.text()
  let candidate: unknown = null
  if (text !== '') {
    try {
      candidate = JSON.parse(text)
    } catch (cause) {
      throw new Error(`${operation}: API returned invalid JSON`, { cause })
    }
  }

  const value = snapshotJsonValue(candidate)
  if (value === undefined) {
    throw new Error(`${operation}: API returned a value that is not lossless JSON`)
  }
  return value as JsonValue
}

function apiFailure(operation: string, response: Response, value: JsonValue): Error {
  const detail = isJsonObject(value) && typeof value['detail'] === 'string'
    ? value['detail']
    : JSON.stringify(value)
  return new Error(`${operation}: API request failed with HTTP ${response.status}: ${detail}`)
}

function jsonOutput() {
  return {
    schema: { type: 'json' } as const,
    render: (_args: unknown, value: JsonValue) => [
      { type: 'text' as const, text: JSON.stringify(value, null, 2) },
    ],
  }
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
  if (config.username.trim() === '') {
    throw new Error('asset-management: username must not be empty')
  }
  if (config.password === '') {
    throw new Error('asset-management: password must not be empty')
  }
  if (config.criticalRiskScore <= config.highRiskScore) {
    throw new Error('asset-management: criticalRiskScore must be greater than highRiskScore')
  }

  const baseUrl = configuredUrl.toString().replace(/\/$/, '')
  let cachedToken: CachedToken | undefined

  async function login(signal: AbortSignal): Promise<string> {
    if (cachedToken !== undefined && Date.now() + TOKEN_REFRESH_MARGIN_MS < cachedToken.expiresAtMs) {
      return cachedToken.value
    }

    const operation = 'asset-management login'
    const response = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: config.username, password: config.password }),
      signal,
    })
    const value = await responseJson(response, operation)
    if (!response.ok) throw apiFailure(operation, response, value)
    if (
      !isJsonObject(value)
      || typeof value['access_token'] !== 'string'
      || typeof value['expires_at'] !== 'number'
      || !Number.isFinite(value['expires_at'])
    ) {
      throw new Error(`${operation}: response must contain access_token and expires_at`)
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
      const response = await fetch(`${baseUrl}${path}`, {
        headers: { authorization: `Bearer ${token}` },
        signal,
      })
      if (response.status === 401 && attempt === 0) {
        await response.text()
        cachedToken = undefined
        continue
      }

      const value = await responseJson(response, operation)
      if (!response.ok) throw apiFailure(operation, response, value)
      return value
    }
    throw new Error(`${operation}: authentication retry did not produce a response`)
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
        throw new Error(`${operation}: total changed during pagination`)
      }
      collected.push(...result.items)
      if (collected.length >= expectedTotal) return collected.slice(0, expectedTotal)
      if (result.items.length === 0) {
        throw new Error(`${operation}: pagination ended before all ${expectedTotal} records were returned`)
      }
    }
  }

  ctx.tools.register(defineTool({
    name: 'asset_list',
    description:
      '查询或筛选网络安全资产列表。用户要求查找、盘点或统计匹配的资产时调用；search 可匹配资产编码、名称、IP 地址或主机名。',
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
    presentCall: args => ({
      card: 'generic',
      title: args.search === undefined ? '查询资产列表' : `查找资产：${args.search}`,
      kind: 'search',
      rawInput: args.search ?? args,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_get',
    description: '按数字 ID 查询一项资产的完整详情，包括该资产关联的漏洞和安全事件。',
    parameters: {
      asset_id: { type: 'integer', required: true, description: '要查询的资产数字 ID。' },
    },
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (args, exec) => get(`/assets/${args.asset_id}`, exec.signal, 'asset_get'),
    presentCall: args => ({
      card: 'generic',
      title: `查询资产 ${args.asset_id}`,
      kind: 'read',
      rawInput: args.asset_id,
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_ownership_statistics',
    description: '查询资产责任人覆盖情况，返回资产总数、有责任人数量和无责任人数量。',
    parameters: {},
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (_args, exec) => get(
      '/statistics/assets/ownership',
      exec.signal,
      'asset_ownership_statistics',
    ),
    presentCall: () => ({
      card: 'generic',
      title: '查询资产责任人覆盖情况',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'asset_risk_overview',
    description:
      '查询全部资产的风险概览，返回漏洞和安全事件总数、处置状态统计以及每项资产的关联风险数量。',
    parameters: {},
    output: jsonOutput(),
    timeoutMs: config.timeoutMs,
    execute: (_args, exec) => get(
      '/statistics/assets/risk-overview',
      exec.signal,
      'asset_risk_overview',
    ),
    presentCall: () => ({
      card: 'generic',
      title: '查询资产风险概览',
      kind: 'read',
    }),
  }))

  ctx.tools.register(defineTool({
    name: 'assess_asset_risk',
    description:
      '执行重点资产风险评估。先筛选 critical/high 资产，再分别查询每项资产的 critical/high 漏洞和安全事件，综合资产重要度、暴露面、责任人、未闭环风险和未响应风险判断是否高风险。用户询问资产是否风险高、重点资产风险或要求多维风险研判时，优先调用本工具。',
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
    presentCall: args => ({
      card: 'generic',
      title: args.search === undefined ? '评估重点资产风险' : `评估资产风险：${args.search}`,
      kind: 'search',
      rawInput: args.search,
    }),
  }))
}

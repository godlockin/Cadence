/**
 * @cadence/nodes — RESULT-VALIDATE category (2 nodes).
 *
 * Validate a downstream node's result before continuing.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import { emitFinished, emitResult, emitStarted, flowInput, flowResult } from '../lib/context.js'
import { validateWithSchema, type JsonSchema } from '../lib/json-schema.js'

/* ------------------------------------------------------------ zod-schema -- */

const ResultZodSchemaConfigSchema = z.object({
  schema: z.record(z.unknown()),
  /** When true, reject on an invalid result. */
  strict: z.boolean().default(true),
  /** Which result to validate: the flow value or the execution result JSON. */
  source: z.enum(['flow', 'execution']).default('flow'),
})

export const resultZodSchemaNode = defineNode<z.infer<typeof ResultZodSchemaConfigSchema>>({
  kind: 'zod-schema.v1',
  type: 'result-validate',
  configSchema: ResultZodSchemaConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const value = config.source === 'execution' ? flowResult(ctx) : flowInput(config, ctx)
    emitStarted(ctx)
    const errors = validateWithSchema(config.schema as unknown as JsonSchema, value)
    if (errors.length > 0 && config.strict) {
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, errors } })
      throw new Error(`result validation failed: ${errors[0]?.message ?? 'unknown'}`)
    }
    emitResult(ctx, { valid: errors.length === 0, errors })
    emitFinished(ctx)
  },
})

/* ------------------------------------------------------------- http-status -- */

const HttpStatusConfigSchema = z.object({
  /** Expected status codes, e.g. [200, 201]. */
  statuses: z.array(z.number().int().min(100).max(599)).min(1),
  /** Required response headers (name → expected value or presence only). */
  requireHeaders: z.record(z.string()).default({}),
  /** When true, reject on a failed check. */
  strict: z.boolean().default(true),
})

export const httpStatusNode = defineNode<z.infer<typeof HttpStatusConfigSchema>>({
  kind: 'http-status.v1',
  type: 'result-validate',
  configSchema: HttpStatusConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const value = flowInput(config, ctx)
    emitStarted(ctx)
    const failures: string[] = []

    const status = extractStatus(value)
    if (status === null) {
      failures.push('result does not expose a numeric status code')
    } else if (!config.statuses.includes(status)) {
      failures.push(`status ${status} not in ${config.statuses.join(',')}`)
    }

    const headers = extractHeaders(value)
    for (const [name, expected] of Object.entries(config.requireHeaders)) {
      const actual = headers[name.toLowerCase()]
      if (actual === undefined) {
        failures.push(`missing header '${name}'`)
      } else if (expected !== '' && actual !== expected) {
        failures.push(`header '${name}' expected '${expected}' got '${actual}'`)
      }
    }

    if (failures.length > 0 && config.strict) {
      ctx.emit({ type: 'error', ts: Date.now(), data: { code: 400, failures } })
      throw new Error(`http-status failed: ${failures[0]}`)
    }
    emitResult(ctx, { ok: failures.length === 0, failures })
    emitFinished(ctx)
  },
})

function extractStatus(value: unknown): number | null {
  if (value !== null && typeof value === 'object') {
    const obj = value as unknown as Record<string, unknown>
    const status = obj['status'] ?? obj['statusCode']
    if (typeof status === 'number' && Number.isInteger(status)) return status
  }
  return null
}

function extractHeaders(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object') return {}
  const obj = value as unknown as Record<string, unknown>
  const raw = obj['headers']
  if (raw === null || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as unknown as Record<string, unknown>)) {
    out[k.toLowerCase()] = String(v)
  }
  return out
}

export const RESULT_VALIDATE_NODES = [resultZodSchemaNode, httpStatusNode] as const

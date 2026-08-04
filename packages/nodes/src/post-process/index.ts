/**
 * @cadence/nodes — POST-PROCESS category (4 nodes).
 *
 * Side-effects that run after the main transform is done.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import { emitFinished, emitResult, emitStarted, flowInput } from '../lib/context.js'
import { incrementCounter, snapshotCounters } from '../lib/metrics.js'

/* ---------------------------------------------------------------- db-write -- */

const DbWriteConfigSchema = z.object({
  dialect: z.enum(['json', 'sqlite']).default('json'),
  /** JSON dialect: rows to append to the in-memory "table". */
  rows: z.array(z.record(z.unknown())).default([]),
  /** sqlite TODO(phase-6): file path / connection string. */
  connection: z.string().optional(),
})

/** Module-level JSON "table" backing the json dialect (test-inspectable). */
export const jsonTable: Record<string, unknown>[] = []

export function resetJsonTable(): void {
  jsonTable.length = 0
}

export const dbWriteNode = defineNode<z.infer<typeof DbWriteConfigSchema>>({
  kind: 'db-write.v1',
  type: 'post-process',
  configSchema: DbWriteConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { dialect: config.dialect })
    if (config.dialect === 'sqlite') {
      throw new Error('db-write sqlite dialect is not implemented yet (use dialect=json)')
    }
    let rows = config.rows
    if (rows.length === 0) {
      const flow = flowInput(config, ctx)
      if (Array.isArray(flow))
        rows = flow.filter((r): r is Record<string, unknown> => r !== null && typeof r === 'object')
    }
    for (const row of rows) jsonTable.push({ ...row })
    emitResult(ctx, { written: rows.length, total: jsonTable.length })
    emitFinished(ctx)
  },
})

/* --------------------------------------------------------------- log-save -- */

const LogSaveConfigSchema = z.object({
  message: z.string().min(1),
  level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  /** Optional file to append the log line to (local-only). */
  file: z.string().optional(),
  /** When set, capture the flow value alongside the message. */
  includePayload: z.boolean().default(false),
})

export const logSaveNode = defineNode<z.infer<typeof LogSaveConfigSchema>>({
  kind: 'log-save.v1',
  type: 'post-process',
  configSchema: LogSaveConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { level: config.level })
    const payload = config.includePayload ? flowInput(config, ctx) : undefined
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level: config.level,
      message: config.message,
      ...(payload !== undefined ? { payload } : {}),
    })
    ctx.emit({ type: 'log', ts: Date.now(), data: { stream: config.level, text: line } })
    if (config.file) {
      const fs = await import('node:fs/promises')
      await fs.appendFile(config.file, `${line}\n`, 'utf8')
    }
    emitResult(ctx, { level: config.level, message: config.message })
    emitFinished(ctx)
  },
})

/* ----------------------------------------------------- notification-dispatch -- */

const NotificationDispatchConfigSchema = z.object({
  channel: z.enum(['log', 'http', 'desktop', 'email']).default('log'),
  title: z.string().default('PulseDeck'),
  body: z.string().min(1),
  /** http channel: webhook target URL. */
  url: z.string().url().optional(),
  /** email channel: recipients. TODO(phase-6): real SMTP transport. */
  to: z.array(z.string().email()).default([]),
})

export const notificationDispatchNode = defineNode<
  z.infer<typeof NotificationDispatchConfigSchema>
>({
  kind: 'notification-dispatch.v1',
  type: 'post-process',
  configSchema: NotificationDispatchConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { channel: config.channel })
    if (config.channel === 'http') {
      if (!config.url) throw new Error('notification-dispatch http channel requires url')
      const res = await fetch(config.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: config.title, body: config.body, ts: Date.now() }),
        signal: ctx.signal,
      })
      if (!res.ok) throw new Error(`notification http ${res.status}`)
      emitResult(ctx, { channel: 'http', status: res.status })
    } else if (config.channel === 'email') {
      /* TODO(phase-6): real SMTP transport. Stub acknowledges the recipients. */
      emitResult(ctx, { channel: 'email', to: config.to, queued: config.to.length })
    } else if (config.channel === 'desktop') {
      const { buildDesktopNotification } = await import('../lib/desktop.js')
      const built = buildDesktopNotification({
        title: config.title,
        body: config.body,
        interactive: false,
        buttons: [],
        timeoutMs: 10_000,
        dryRun: true,
      })
      emitResult(ctx, { channel: 'desktop', command: built.command, args: built.args })
    } else {
      ctx.emit({ type: 'log', ts: Date.now(), data: { stream: 'notification', text: config.body } })
      emitResult(ctx, { channel: 'log', body: config.body })
    }
    emitFinished(ctx)
  },
})

/* ------------------------------------------------------------- metric-emit -- */

const MetricEmitConfigSchema = z.object({
  name: z.string().regex(/^[a-zA-Z_:][a-zA-Z0-9_:]*$/),
  help: z.string().default('pulsedeck counter'),
  labels: z.record(z.string()).default({}),
  delta: z.number().int().min(0).default(1),
})

export const metricEmitNode = defineNode<z.infer<typeof MetricEmitConfigSchema>>({
  kind: 'metric-emit.v1',
  type: 'post-process',
  configSchema: MetricEmitConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { name: config.name })
    const value = incrementCounter(config.name, config.help, config.labels, config.delta)
    emitResult(ctx, { name: config.name, value })
    emitFinished(ctx)
  },
})

export { snapshotCounters }

export const POST_PROCESS_NODES = [
  dbWriteNode,
  logSaveNode,
  notificationDispatchNode,
  metricEmitNode,
] as const

/**
 * @cadence/nodes — INPUT category (8 nodes).
 *
 * Nodes that source the initial payload of a run.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import {
  emitFinished,
  emitResult,
  emitStarted,
  flowInput,
  NODE_UNSUPPORTED_IN_RUNTIME,
} from '../lib/context.js'
import { HttpRequestConfigSchema, runGuardedHttp } from '../lib/http.js'
import { runCommand } from '../lib/shell.js'
import { evaluateJsonPath } from '../lib/json-path.js'

/* ---------------------------------------------------------------- curl -- */

export const curlNode = defineNode<z.infer<typeof HttpRequestConfigSchema>>({
  kind: 'curl.v1',
  type: 'input',
  configSchema: HttpRequestConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { url: config.url })
    const res = await runGuardedHttp(config, ctx.signal)
    emitResult(ctx, { status: res.status, headers: res.headers, body: res.body, url: res.url })
    emitFinished(ctx)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
  },
})

/* -------------------------------------------------------------- webhook -- */

const InputWebhookConfigSchema = z.object({
  path: z.string().regex(/^\//, 'path must start with /'),
  methods: z.array(z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])).default(['POST']),
  secret: z.string().optional(),
})

export const inputWebhookNode = defineNode<z.infer<typeof InputWebhookConfigSchema>>({
  kind: 'webhook.v1',
  type: 'input',
  configSchema: InputWebhookConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { path: config.path, methods: config.methods })
    const data = flowInput(config, ctx)
    emitResult(ctx, { path: config.path, methods: config.methods, payload: data })
    emitFinished(ctx)
  },
})

/* ---------------------------------------------------------------- shell -- */

const InputShellConfigSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
})

export const inputShellNode = defineNode<z.infer<typeof InputShellConfigSchema>>({
  kind: 'shell.v1',
  type: 'input',
  configSchema: InputShellConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { cmd: config.cmd })
    const result = await runCommand(config, ctx)
    emitResult(ctx, result)
    emitFinished(ctx)
    if (result.exitCode !== 0) {
      throw new Error(`Command '${config.cmd}' exited with code ${result.exitCode}`)
    }
  },
})

/* ------------------------------------------------------ schedule-trigger -- */

const ScheduleTriggerConfigSchema = z
  .object({
    cron: z.string().optional(),
    everyMs: z.number().int().positive().optional(),
    timezone: z.string().default('UTC'),
    note: z.string().optional(),
  })
  .refine((v) => v.cron !== undefined || v.everyMs !== undefined, {
    message: 'schedule-trigger requires either cron or everyMs',
  })

export const scheduleTriggerNode = defineNode<z.infer<typeof ScheduleTriggerConfigSchema>>({
  kind: 'schedule-trigger.v1',
  type: 'input',
  configSchema: ScheduleTriggerConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { cron: config.cron ?? null, everyMs: config.everyMs ?? null })
    emitResult(ctx, {
      schedule: {
        cron: config.cron ?? null,
        everyMs: config.everyMs ?? null,
        timezone: config.timezone,
      },
      note: config.note ?? null,
      payload: flowInput(config, ctx),
    })
    emitFinished(ctx)
  },
})

/* -------------------------------------------------------- manual-trigger -- */

const ManualTriggerConfigSchema = z.object({
  note: z.string().optional(),
})

export const manualTriggerNode = defineNode<z.infer<typeof ManualTriggerConfigSchema>>({
  kind: 'manual-trigger.v1',
  type: 'input',
  configSchema: ManualTriggerConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { note: config.note ?? null })
    emitResult(ctx, { note: config.note ?? null, payload: flowInput(config, ctx) })
    emitFinished(ctx)
  },
})

/* ---------------------------------------------------------- file-watcher -- */

const FileWatcherConfigSchema = z.object({
  path: z.string().min(1),
  recursive: z.boolean().default(true),
  extensions: z.array(z.string()).default([]),
})

export const fileWatcherNode = defineNode<z.infer<typeof FileWatcherConfigSchema>>({
  kind: 'file-watcher.v1',
  type: 'input',
  configSchema: FileWatcherConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { path: config.path })
    const files = await snapshotDir(config.path, config.recursive, config.extensions)
    emitResult(ctx, { path: config.path, files, count: files.length })
    emitFinished(ctx)
  },
})

async function snapshotDir(
  dir: string,
  recursive: boolean,
  extensions: readonly string[],
): Promise<{ path: string; size: number; mtimeMs: number }[]> {
  const fs = await import('node:fs/promises')
  const out: { path: string; size: number; mtimeMs: number }[] = []
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = `${dir.replace(/\/$/, '')}/${entry.name}`
    if (entry.isDirectory()) {
      if (recursive) out.push(...(await snapshotDir(full, recursive, extensions)))
    } else if (entry.isFile()) {
      if (extensions.length > 0 && !extensions.some((ext) => entry.name.endsWith(ext))) continue
      const stat = await fs.stat(full)
      out.push({ path: full, size: stat.size, mtimeMs: stat.mtimeMs })
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path))
}

/* ------------------------------------------------------------ email-inbox -- */

const EmailInboxConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().default(993),
  username: z.string().min(1),
  password: z.string().optional(),
  mailbox: z.string().default('INBOX'),
  maxMessages: z.number().int().min(1).max(500).default(10),
  /** 'stub' returns an empty mailbox without a live IMAP connection (default). */
  mode: z.enum(['stub', 'imap']).default('stub'),
})

export const emailInboxNode = defineNode<z.infer<typeof EmailInboxConfigSchema>>({
  kind: 'email-inbox.v1',
  type: 'input',
  configSchema: EmailInboxConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { host: config.host, mailbox: config.mailbox })
    if (config.mode === 'imap') {
      /* TODO(phase-6): live IMAP poll via imapflow. Requires network + creds. */
      throw new Error('email-inbox imap mode is not implemented yet (use mode=stub)')
    }
    emitResult(ctx, {
      mailbox: config.mailbox,
      messages: [] as unknown[],
      count: 0,
      mode: 'stub',
      host: config.host,
    })
    emitFinished(ctx)
  },
})

/* --------------------------------------------------------------- db-poll -- */

const DbPollConfigSchema = z.object({
  dialect: z.enum(['json', 'sqlite']).default('json'),
  /** JSON dialect: the dataset to query (or falls back to trigger payload). */
  data: z.unknown().optional(),
  /** JSONPath query applied to the dataset. */
  query: z.string().default('$'),
  /** sqlite TODO(phase-6): file path / connection string. */
  connection: z.string().optional(),
})

export const dbPollNode = defineNode<z.infer<typeof DbPollConfigSchema>>({
  kind: 'db-poll.v1',
  type: 'input',
  configSchema: DbPollConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { dialect: config.dialect })
    if (config.dialect === 'sqlite') {
      ctx.emit({
        type: 'error',
        ts: Date.now(),
        data: { code: NODE_UNSUPPORTED_IN_RUNTIME, message: 'sqlite dialect not implemented' },
      })
      throw new Error('db-poll sqlite dialect is not implemented yet (use dialect=json)')
    }
    const dataset = config.data ?? flowInput(config, ctx)
    const rows = evaluateJsonPath(config.query, dataset)
    emitResult(ctx, { dialect: 'json', rows, count: rows.length })
    emitFinished(ctx)
  },
})

export const INPUT_NODES = [
  curlNode,
  inputWebhookNode,
  inputShellNode,
  scheduleTriggerNode,
  manualTriggerNode,
  fileWatcherNode,
  emailInboxNode,
  dbPollNode,
] as const

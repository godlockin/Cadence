/**
 * @cadence/nodes — OUTPUT category (6 nodes).
 *
 * Nodes that emit the final result of a run.
 */
import { z } from 'zod'
import { defineNode } from '../registry.js'
import { emitFinished, emitResult, emitStarted, flowInput } from '../lib/context.js'
import { runCommand } from '../lib/shell.js'
import { buildDesktopNotification } from '../lib/desktop.js'
import { runGuardedHttp } from '../lib/http.js'

/* ----------------------------------------------------------- http-response -- */

const HttpResponseConfigSchema = z.object({
  status: z.number().int().min(100).max(599).default(200),
  headers: z.record(z.string()).default({}),
  /** The body to return (defaults to flow value). */
  body: z.unknown().optional(),
  contentType: z.string().default('application/json'),
})

export const httpResponseNode = defineNode<z.infer<typeof HttpResponseConfigSchema>>({
  kind: 'http-response.v1',
  type: 'output',
  configSchema: HttpResponseConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    const body = config.body ?? flowInput(config, ctx)
    emitStarted(ctx, { status: config.status })
    emitResult(ctx, {
      status: config.status,
      headers: { 'content-type': config.contentType, ...config.headers },
      body,
    })
    emitFinished(ctx)
  },
})

/* ---------------------------------------------------------------- webhook -- */

const OutputWebhookConfigSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('POST'),
  headers: z.record(z.string()).default({}),
  body: z.unknown().optional(),
  timeoutMs: z.number().int().min(100).max(300_000).default(15_000),
  skip_dns_check: z.boolean().default(false),
})

export const outputWebhookNode = defineNode<z.infer<typeof OutputWebhookConfigSchema>>({
  kind: 'webhook.v1',
  type: 'output',
  configSchema: OutputWebhookConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { url: config.url })
    const payload = config.body ?? flowInput(config, ctx)
    const res = await runGuardedHttp(
      {
        url: config.url,
        method: config.method,
        headers: config.headers,
        body: payload,
        timeoutMs: config.timeoutMs,
        allow_insecure: false,
        skip_dns_check: config.skip_dns_check,
        follow_redirects: true,
        max_redirects: 5,
      },
      ctx.signal,
    )
    emitResult(ctx, { status: res.status, url: res.url })
    emitFinished(ctx)
    if (!res.ok) throw new Error(`webhook HTTP ${res.status}`)
  },
})

/* -------------------------------------------------------------- email-send -- */

const EmailSendConfigSchema = z.object({
  to: z.array(z.string().email()).min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  from: z.string().email().default('noreply@cadence.local'),
  /** 'stub' returns a synthetic message-id without a live SMTP connection. */
  mode: z.enum(['stub', 'smtp']).default('stub'),
  /** smtp mode TODO(phase-6): host/port/credentials. */
  host: z.string().optional(),
  port: z.number().int().default(587),
  username: z.string().optional(),
  password: z.string().optional(),
})

export const emailSendNode = defineNode<z.infer<typeof EmailSendConfigSchema>>({
  kind: 'email-send.v1',
  type: 'output',
  configSchema: EmailSendConfigSchema,
  runtimes: ['node', 'cloudflare'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { to: config.to })
    if (config.mode === 'smtp') {
      /* TODO(phase-6): real SMTP transport via nodemailer. */
      throw new Error('email-send smtp mode is not implemented yet (use mode=stub)')
    }
    const messageId = `pulsedeck-${Date.now().toString(36)}@${config.from.split('@')[1] ?? 'pulsedeck.local'}`
    emitResult(ctx, { messageId, to: config.to, subject: config.subject, mode: 'stub' })
    emitFinished(ctx)
  },
})

/* ----------------------------------------------------- desktop-notification -- */

const DesktopNotificationConfigSchema = z.object({
  title: z.string().min(1),
  body: z.string().min(1),
  interactive: z.boolean().default(false),
  buttons: z.array(z.string()).default([]),
  timeoutMs: z.number().int().min(100).default(10_000),
  /** dryRun builds the OS command without spawning it. */
  dryRun: z.boolean().default(true),
})

export const desktopNotificationNode = defineNode<z.infer<typeof DesktopNotificationConfigSchema>>({
  kind: 'desktop-notification.v1',
  type: 'output',
  configSchema: DesktopNotificationConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { title: config.title })
    const built = buildDesktopNotification(config)
    if (!config.dryRun) {
      const result = await runCommand(
        { cmd: built.command, args: [...built.args], env: {}, timeoutMs: config.timeoutMs },
        ctx,
      )
      if (result.exitCode !== 0) throw new Error(`desktop notification exited ${result.exitCode}`)
    }
    emitResult(ctx, {
      command: built.command,
      args: built.args,
      dryRun: config.dryRun,
      platform: built.platform,
    })
    emitFinished(ctx)
  },
})

/* -------------------------------------------------------------- shell-exec -- */

const ShellExecConfigSchema = z.object({
  cmd: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).default({}),
  timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
})

export const shellExecNode = defineNode<z.infer<typeof ShellExecConfigSchema>>({
  kind: 'shell-exec.v1',
  type: 'output',
  configSchema: ShellExecConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { cmd: config.cmd })
    const result = await runCommand(config, ctx)
    emitResult(ctx, { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr })
    emitFinished(ctx)
    if (result.exitCode !== 0)
      throw new Error(`Command '${config.cmd}' exited with code ${result.exitCode}`)
  },
})

/* -------------------------------------------------------------- file-write -- */

const FileWriteConfigSchema = z.object({
  /** Absolute path of the file to write. */
  path: z.string().min(1),
  /** Content to write (JSON-serialised unless it's already a string). */
  content: z.unknown().optional(),
  mode: z.enum(['overwrite', 'append']).default('overwrite'),
  /** Path must live under /tmp or $HOME (mirrors the command sandbox). */
  pathGuard: z.boolean().default(true),
})

export const fileWriteNode = defineNode<z.infer<typeof FileWriteConfigSchema>>({
  kind: 'file-write.v1',
  type: 'output',
  configSchema: FileWriteConfigSchema,
  runtimes: ['node'],
  handler: async (config, ctx) => {
    emitStarted(ctx, { path: config.path })
    if (config.pathGuard) {
      const path = await import('node:path')
      const os = await import('node:os')
      const home = os.homedir()
      const tmp = os.tmpdir()
      const resolved = path.resolve(config.path)
      const safe =
        resolved === tmp ||
        resolved.startsWith(`${tmp}/`) ||
        resolved === home ||
        resolved.startsWith(`${home}/`)
      if (!safe) throw new Error(`file-write path '${config.path}' is not under /tmp or $HOME`)
    }
    const content = config.content ?? flowInput(config, ctx)
    const text = typeof content === 'string' ? content : JSON.stringify(content)
    const fs = await import('node:fs/promises')
    if (config.mode === 'append') {
      await fs.appendFile(config.path, `${text}\n`, 'utf8')
    } else {
      await fs.writeFile(config.path, text, 'utf8')
    }
    emitResult(ctx, {
      path: config.path,
      mode: config.mode,
      bytes: Buffer.byteLength(text, 'utf8'),
    })
    emitFinished(ctx)
  },
})

export const OUTPUT_NODES = [
  httpResponseNode,
  outputWebhookNode,
  emailSendNode,
  desktopNotificationNode,
  shellExecNode,
  fileWriteNode,
] as const

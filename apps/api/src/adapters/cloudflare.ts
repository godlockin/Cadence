/**
 * @cadence/api — Cloudflare Workers adapter.
 *
 * Reads the bindings/secret env:
 *  - `env.PULSEDECK_DB`     — D1 binding
 *  - `env.JWT_SECRET`       — HS256 signing key (string)
 *  - `env.ENCRYPTION_KEY`   — base64 AES-256 master key
 *
 * Returns a fully-wired app ready to be `export default`'d from
 * `worker.ts`. The function performs eager validation (fail fast) so a
 * missing binding crashes at startup, not at the first request.
 *
 * Additionally wires a `CloudflareSchedulerAdapter` for Durable-Object alarm
 * bookkeeping, and exports `onScheduled` so `worker.ts` can register a
 * `scheduled` Cron Trigger controller.
 */
import { ulid } from 'ulid'
import { createApp, type AppEnv, type CreateAppDeps } from '../index.js'
import {
  createJwtSigner,
  createCredentialCipher,
  AuthService,
  OAuth2Refresher,
  RefreshSchedulerImpl,
} from '@cadence/auth'
import { createStorageAdapter, type D1Binding } from '@cadence/storage'
import {
  CloudflareSchedulerAdapter,
  EmbeddedSchedulerAdapter,
  SchedulerHandle,
  type ResolveStub,
  type TriggerFn,
} from '@cadence/scheduler'

export interface CloudflareEnv {
  readonly PULSEDECK_DB: D1Binding
  readonly JWT_SECRET: string
  readonly ENCRYPTION_KEY: string
  readonly NODE_ENV?: string
  /** Optional: namespace for DO instances. Defaults to "default". */
  readonly PULSEDECK_DO_NAMESPACE?: string
}

function decodeKey(b64: string): Uint8Array {
  const cleaned = b64.replace(/[^A-Za-z0-9+/=]/g, '')
  const buf = Buffer.from(cleaned, 'base64')
  if (buf.byteLength !== 32) {
    throw new Error(`ENCRYPTION_KEY must decode to 32 bytes (got ${buf.byteLength.toString()})`)
  }
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

/**
 * Cloudflare triggerFn: writes a queued execution row directly via the
 * storage adapter. The Workers Cron Trigger itself cannot reach into the
 * SinkerEngine — the worker loop is shimmed here. Production deployments
 * should swap this for a queue worker (PHASE 5+).
 */
function buildCloudflareTriggerFn(storage: ReturnType<typeof createStorageAdapter>): TriggerFn {
  return async (taskId, ctx, opts) => {
    const task = await storage.getTask(taskId)
    if (task === null) return null
    void opts
    const now = Date.now()
    const executionId = ulid() as ReturnType<typeof ulid>
    await storage.createExecution({
      id: executionId as never,
      taskId,
      status: 'queued',
      triggerSource: ctx.source,
      triggeredBy: null,
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: ctx.idempotencyKey ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    } as unknown as Parameters<typeof storage.createExecution>[0])
    return executionId as never
  }
}

export interface CloudflareApp {
  app: ReturnType<typeof createApp>
  deps: CreateAppDeps
  scheduler: SchedulerHandle
  schedulerAdapter: CloudflareSchedulerAdapter
  /**
   * PHASE 6: credential refresh scheduler (driven by the Cron Trigger).
   */
  credentialRefreshScheduler: RefreshSchedulerImpl
  /**
   * Cron Trigger handler — registered by `worker.ts` as the
   * `scheduled(...)` controller. The host matches the controller's
   * cron expression against `wrangler.toml` crons.
   */
  onScheduled(event: { readonly cron: string; readonly scheduledTime: number }): Promise<void>
}

export function buildCloudflareApp(env: CloudflareEnv): CloudflareApp {
  if (typeof env.PULSEDECK_DB === 'undefined') {
    throw new Error('buildCloudflareApp: PULSEDECK_DB binding is missing')
  }
  if (typeof env.JWT_SECRET !== 'string' || env.JWT_SECRET.length < 16) {
    throw new Error('buildCloudflareApp: JWT_SECRET must be at least 16 chars')
  }
  const storage = createStorageAdapter({ kind: 'd1', binding: env.PULSEDECK_DB })
  const jwt = createJwtSigner(env.JWT_SECRET)
  const cipherKey = decodeKey(env.ENCRYPTION_KEY)
  void createCredentialCipher(cipherKey)
  const auth = new AuthService({ storage, jwt })

  /* DO stub resolver. In production this would talk to a real
   * Durable Object namespace binding. Tests inject their own. */
  const resolveStub: ResolveStub = (taskId) => {
    /* A minimal stub that records setAlarm/deleteAlarm but doesn't
     * actually call into a DO (DO binding isn't part of the contract).
     * Real Workers deployments MUST override this from a binding. */
    const taskIdStr = String(taskId)
    void taskIdStr
    throw new Error(
      'buildCloudflareApp: DO namespace binding not provided; register tasks via the API',
    )
  }
  const schedulerAdapter = new CloudflareSchedulerAdapter({ resolveStub })

  const triggerFn = buildCloudflareTriggerFn(storage)
  const scheduler = new SchedulerHandle({
    storage,
    triggerFn,
  })

  /* PHASE 6: credential refresh engine + sweep. The Workers Cron Trigger
   * drives `runOnce()` (see onScheduled below). */
  const cipher = createCredentialCipher(cipherKey)
  const credentialRefresher = new OAuth2Refresher(cipher, storage)
  const credentialRefreshScheduler = new RefreshSchedulerImpl(
    storage,
    credentialRefresher,
    new EmbeddedSchedulerAdapter(),
  )

  const deps: CreateAppDeps = {
    storage,
    auth,
    jwt,
    encryptionKey: cipherKey,
    scheduler,
    credentialRefresher,
  }
  const app = createApp(deps)

  return {
    app,
    deps,
    scheduler,
    schedulerAdapter,
    credentialRefreshScheduler,
    async onScheduled(event): Promise<void> {
      /* Every-minute cron → run the credential refresh sweep. */
      if (event.cron === '* * * * *') {
        await credentialRefreshScheduler.runOnce()
      }
    },
  }
}

export type { AppEnv }

/**
 * @cadence/api — Node.js adapter.
 *
 * Reads from `process.env`:
 *  - `PULSEDECK_DB_PATH`  — sqlite file path (default `:memory:`)
 *  - `JWT_SECRET`         — HS256 signing key
 *  - `ENCRYPTION_KEY`     — base64 AES-256 master key (32 bytes raw)
 *  - `PULSEDECK_SCHEDULER_ENABLED` — "1" to start the cron loop (default 0)
 *
 * Boots a `SqliteStorageAdapter` (better-sqlite3 + drizzle). The migration
 * runner is invoked synchronously at startup.
 *
 * If scheduler is enabled, a `SchedulerHandle` is constructed and the cron
 * loop is fired in the background. The same handle is exposed to the Hono
 * app via `deps.scheduler`, so `/api/health` can report it.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from '@cadence/db'
import { createApp, type CreateAppDeps } from '../index.js'
import {
  createJwtSigner,
  createCredentialCipher,
  AuthService,
  OAuth2Refresher,
  RefreshSchedulerImpl,
  PendingCredentialRefresh,
  hashPassword,
} from '@cadence/auth'
import { randomUUID } from 'node:crypto'
import { createStorageAdapter, type SqliteDatabase } from '@cadence/storage'
import { SchedulerHandle, EmbeddedSchedulerAdapter, type TriggerFn } from '@cadence/scheduler'
import { ulid } from 'ulid'

export interface NodeEnv {
  readonly PULSEDECK_DB_PATH?: string
  readonly JWT_SECRET?: string
  readonly ENCRYPTION_KEY?: string
  readonly PULSEDECK_SCHEDULER_ENABLED?: string
}

function resolveKey(secret?: string): string {
  if (typeof secret === 'string' && secret.length >= 16) return secret
  if (process.env['JWT_SECRET'] !== undefined && process.env['JWT_SECRET'].length >= 16) {
    return process.env['JWT_SECRET']
  }
  /* Dev fallback: deterministic but documented. Production MUST set env. */
  return 'dev-jwt-secret-do-not-use-in-prod-32b'
}

function resolveEncryptionKey(b64?: string): Uint8Array {
  const raw = b64 ?? process.env['ENCRYPTION_KEY']
  if (typeof raw === 'string') {
    const cleaned = raw.replace(/[^A-Za-z0-9+/=]/g, '')
    const buf = Buffer.from(cleaned, 'base64')
    if (buf.byteLength === 32) {
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
    }
  }
  /* Dev fallback: 32 bytes of zeros. NEVER use in production. */
  return new Uint8Array(32)
}

/** Auto-create default admin if DB has zero users (first boot). */
async function ensureDefaultAdmin(storage: ReturnType<typeof createStorageAdapter>): Promise<void> {
  const existing = await storage.listUsers({ limit: 1 })
  if (existing.length > 0) return

  const now = new Date().toISOString()
  await storage.saveUser({
    id: randomUUID() as string & { __brand: 'UserId' },
    email: 'admin@cadence.local',
    displayName: '默认管理员',
    role: 'admin',
    passwordHash: await hashPassword('pulsedeck'),
    isActive: true,
    isSuperadmin: true,
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
  } as Parameters<typeof storage.saveUser>[0])
  console.info('[pulsedeck/api] default admin created: admin@cadence.local / pulsedeck')
}

/**
 * Default `TriggerFn` for the SchedulerHandle. Creates an Execution row
 * directly (without going through SinkerEngine) — sufficient for wiring the
 * cron loop in the local Node adapter. A future phase will replace this with
 * a SinkerEngine.trigger() backed implementation once the worker loop is
 * wired up in @cadence/api.
 */
function buildLocalTriggerFn(storage: ReturnType<typeof createStorageAdapter>): TriggerFn {
  return async (taskId, ctx, opts) => {
    const task = await storage.getTask(taskId)
    if (task === null) return null
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
    void opts /* reserved for bypass logging */
    return executionId as unknown as ReturnType<TriggerFn> extends Promise<infer R> ? R : never
  }
}

export interface NodeApp {
  app: ReturnType<typeof createApp>
  deps: CreateAppDeps
  db: Database.Database
  scheduler?: SchedulerHandle
  /** PHASE 6: credential refresh sweep (starts when scheduler is enabled). */
  credentialRefresh?: PendingCredentialRefresh
  close(): Promise<void>
}

export function buildNodeApp(env: NodeEnv = {}): NodeApp {
  const dbPath = env.PULSEDECK_DB_PATH ?? process.env['PULSEDECK_DB_PATH'] ?? ':memory:'
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  drizzle(db)
  /* Apply migrations idempotently. */
  migrate(db as unknown as Parameters<typeof migrate>[0])

  const storage = createStorageAdapter({ kind: 'sqlite', db: db as unknown as SqliteDatabase })
  const jwt = createJwtSigner(resolveKey(env.JWT_SECRET))

  /* ─── Auto-create default admin on empty DB ─── */
  ensureDefaultAdmin(storage).catch((e: unknown) => {
    console.error('[pulsedeck/api] failed to seed default admin:', String(e))
  })
  const encryptionKey = resolveEncryptionKey(env.ENCRYPTION_KEY)
  void createCredentialCipher(encryptionKey)
  const auth = new AuthService({ storage, jwt })

  /* Optional scheduler. Opt-in. */
  const enabled =
    (env.PULSEDECK_SCHEDULER_ENABLED ?? process.env['PULSEDECK_SCHEDULER_ENABLED']) === '1'
  let scheduler: SchedulerHandle | undefined
  let credentialRefresh: PendingCredentialRefresh | undefined
  let credentialRefresher: OAuth2Refresher | undefined
  if (enabled) {
    const triggerFn = buildLocalTriggerFn(storage)
    scheduler = new SchedulerHandle({
      storage,
      triggerFn,
      /* Long-running Node process — keep the cron poller alive for 24h
       * instead of the Cloudflare-oriented 60s CPU-bound default. */
      cron: { maxRunMs: 24 * 60 * 60 * 1000 },
    })
    void scheduler.start(storage).catch(() => {
      /* swallow background crash */
    })

    /* PHASE 6: register the credential-refresh sweep as a system cron.
     * A refresh scheduler that owns its own one-off bookkeeping, driven by
     * a 60s sweep (PendingCredentialRefresh). */
    credentialRefresher = new OAuth2Refresher(createCredentialCipher(encryptionKey), storage)
    const refreshScheduler = new RefreshSchedulerImpl(
      storage,
      credentialRefresher,
      new EmbeddedSchedulerAdapter(),
    )
    credentialRefresh = new PendingCredentialRefresh(refreshScheduler, { intervalMs: 60_000 })
    credentialRefresh.start()
  }

  const deps: CreateAppDeps = {
    storage,
    auth,
    jwt,
    encryptionKey,
    ...(scheduler !== undefined ? { scheduler } : {}),
    ...(credentialRefresher !== undefined ? { credentialRefresher } : {}),
  }
  const app = createApp(deps)
  return {
    app,
    deps,
    db,
    ...(scheduler !== undefined ? { scheduler } : {}),
    ...(credentialRefresh !== undefined ? { credentialRefresh } : {}),
    async close() {
      if (scheduler !== undefined) await scheduler.stop().catch(() => {})
      if (credentialRefresh !== undefined) credentialRefresh.stop()
      db.close()
      await storage.close()
    },
  }
}

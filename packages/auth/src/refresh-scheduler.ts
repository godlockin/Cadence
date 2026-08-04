/**
 * @cadence/auth — credential refresh scheduler.
 *
 * Sweeps credentials whose access token is about to expire (lead window)
 * and refreshes them via the injected `CredentialRefresher`. Safety rails:
 *
 *  - distributed lock: a credential with a `running` refresh job is skipped
 *  - circuit breaker: after `maxRetries` consecutive failures the credential
 *    is disabled and its dependent tasks are suspended
 *  - audit trail: every disable is recorded via `appendAudit`
 *
 * `runOnce(now?)` is the per-minute sweep; the host wires it into a cron
 * trigger (see `PendingCredentialRefresh`).
 */
import type { AuditAction, AuditLog, Credential, CredentialId, TaskId } from '@cadence/domain'
import { credentialRefreshPolicy, credentialType } from '@cadence/domain'
import type { SchedulerAdapter } from '@cadence/scheduler'
import type { StorageAdapter } from '@cadence/storage'
import { ConflictError } from '@cadence/storage'
import type { CredentialRefresher } from './credential-refresh.js'
import type { Logger } from './logger.js'
import { noopLogger } from './logger.js'

export interface RefreshResult {
  readonly succeeded: number
  readonly failed: number
  readonly skipped: number
}

export interface RefreshScheduler {
  scheduleRefresh(cred: Credential): Promise<void>
  cancelRefresh(credId: CredentialId): Promise<void>
  runOnce(now?: number): Promise<RefreshResult>
}

export interface RefreshSchedulerOptions {
  /** lead window (ms) before expiry to consider a credential due. Default 5 min. */
  readonly leadWindowMs?: number
  readonly logger?: Logger
  /** generate a refresh-job id. Defaults to crypto.randomUUID(). */
  readonly jobIdFactory?: () => string
}

/* Crockford base32 (26 chars, no I/L/O/U) — matches TaskId's ULID alphabet. */
const SCHEDULE_KEY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** Derive a stable 26-char task-key for a credential's scheduled refresh. */
export function credentialScheduleKey(credId: CredentialId): TaskId {
  let hash = 0
  for (let i = 0; i < credId.length; i++) {
    hash = (hash * 31 + credId.charCodeAt(i)) >>> 0
  }
  let out = ''
  for (let i = 0; i < 26; i++) {
    out += SCHEDULE_KEY_ALPHABET[hash % 32] ?? '0'
    hash = (hash * 33 + i + 1) >>> 0
  }
  return out as TaskId
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export class RefreshSchedulerImpl implements RefreshScheduler {
  private readonly storage: StorageAdapter
  private readonly refresher: CredentialRefresher
  private readonly scheduler: SchedulerAdapter
  private readonly logger: Logger
  private readonly leadWindowMs: number
  private readonly jobIdFactory: () => string

  constructor(
    storage: StorageAdapter,
    refresher: CredentialRefresher,
    scheduler: SchedulerAdapter,
    options: RefreshSchedulerOptions = {},
  ) {
    this.storage = storage
    this.refresher = refresher
    this.scheduler = scheduler
    this.logger = options.logger ?? noopLogger
    this.leadWindowMs = options.leadWindowMs ?? 5 * 60_000
    this.jobIdFactory = options.jobIdFactory ?? (() => crypto.randomUUID())
  }

  async scheduleRefresh(cred: Credential): Promise<void> {
    if (credentialType(cred) === 'static_token') return
    if (cred.expiresAt === null || cred.expiresAt === undefined) return
    const policy = credentialRefreshPolicy(cred)
    const runAt = Math.max(0, cred.expiresAt - policy.leadMinutes * 60_000)
    await this.scheduler.schedule(credentialScheduleKey(cred.id), { runAt })
  }

  async cancelRefresh(credId: CredentialId): Promise<void> {
    await this.scheduler.cancel(credentialScheduleKey(credId))
  }

  async runOnce(now = Date.now()): Promise<RefreshResult> {
    const dueBefore = now + this.leadWindowMs
    const creds = await this.storage.listCredentials({ expiresBefore: dueBefore })

    let succeeded = 0
    let failed = 0
    let skipped = 0

    for (const cred of creds) {
      const type = credentialType(cred)
      if (type === 'static_token') {
        skipped++
        continue
      }
      if (cred.disabledAt !== null && cred.disabledAt !== undefined) {
        skipped++
        continue
      }

      /* Distributed lock — another sweep (or process) already owns this. */
      const running = await this.storage.listRunningRefreshJobs(cred.id)
      if (running.length > 0) {
        skipped++
        continue
      }

      let jobAcquired = false
      try {
        await this.storage.createRefreshJob({
          id: this.jobIdFactory(),
          credId: cred.id,
          status: 'running',
          startedAt: now,
          finishedAt: null,
        })
        jobAcquired = true
      } catch (e) {
        if (e instanceof ConflictError) {
          skipped++
          continue
        }
        throw e
      }

      try {
        await this.refresher.refresh(cred)
        await this.storage.completeRefreshJob(cred.id, 'ok')
        succeeded++
      } catch (e) {
        failed++
        this.logger.error('credential.refresh_failed', {
          credId: cred.id,
          error: errorMessage(e),
        })
        if (jobAcquired) {
          await this.storage.completeRefreshJob(cred.id, 'failed')
        }
        await this.handleFailure(cred)
      }
    }

    return { succeeded, failed, skipped }
  }

  private async handleFailure(cred: Credential): Promise<void> {
    const failures = await this.storage.recordRefreshFailure(cred.id)
    const policy = credentialRefreshPolicy(cred)
    this.logger.warn('credential.refresh_failure_count', {
      credId: cred.id,
      consecutiveFailures: failures,
      maxRetries: policy.maxRetries,
    })

    if (failures < policy.maxRetries || !policy.disabledOnFail) return

    await this.storage.disableCredential(cred.id)
    await this.appendAudit('credential.disabled_after_failures', cred.id, {
      consecutiveFailures: failures,
      maxRetries: policy.maxRetries,
    })

    const tasks = await this.storage.listTasksByCredential(cred.id)
    for (const task of tasks) {
      await this.storage.updateTask(task.id, {
        status: 'suspended',
        expectedVersion: task.version,
      })
    }
  }

  private async appendAudit(
    action: AuditAction,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const entry: AuditLog = {
      id: this.jobIdFactory(),
      action,
      actorId: null,
      resourceKind: 'credential',
      resourceId,
      diffJson: '{}',
      metadataJson: JSON.stringify(metadata),
      createdAt: Date.now(),
    }
    await this.storage.appendAudit(entry)
  }
}

/* -------------------------------------------------------------------------
 * PendingCredentialRefresh — built-in cron trigger.
 *
 * Polls `runOnce` on a fixed interval (default 60s). Hosts call `start()`
 * at backend boot and `stop()` on shutdown.
 * ------------------------------------------------------------------------- */

export interface PendingCredentialRefreshOptions {
  readonly intervalMs?: number
}

export class PendingCredentialRefresh {
  private readonly scheduler: RefreshScheduler
  private readonly intervalMs: number
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(scheduler: RefreshScheduler, options: PendingCredentialRefreshOptions = {}) {
    this.scheduler = scheduler
    this.intervalMs = options.intervalMs ?? 60_000
  }

  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => {
      void this.scheduler.runOnce().catch(() => {
        /* sweep errors are non-fatal — try again next tick */
      })
    }, this.intervalMs)
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  isRunning(): boolean {
    return this.timer !== null
  }
}

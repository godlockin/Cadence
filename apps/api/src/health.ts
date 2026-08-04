/**
 * @cadence/api — health check shape.
 *
 * The endpoint itself is mounted in `routes/scheduler.ts`; this module
 * exposes the type + a typed status reporter.
 */
import type { StorageAdapter } from '@cadence/storage'

import type { SchedulerHandle, SchedulerStatus } from '@cadence/scheduler'

export const API_VERSION = '0.4.0'

export interface HealthStatus {
  readonly status: 'ok' | 'degraded'
  readonly db: boolean
  readonly scheduler: SchedulerStatus
  readonly uptime: number
  readonly version: string
  readonly ts: number
}

/**
 * Best-effort health probe. We can't run a true `ping()` against the
 * `StorageAdapter` interface from PHASE 2 (the contract doesn't expose
 * one), so we fall back to a `listUsers({ limit: 0 })` round-trip. If
 * the adapter throws, we report `degraded`.
 */
export async function healthCheck(
  storage: StorageAdapter,
  scheduler: SchedulerHandle,
  options: {
    readonly uptime?: () => number
    readonly version?: string
  } = {},
): Promise<HealthStatus> {
  const uptime = options.uptime ?? (() => process.uptime())
  const version = options.version ?? API_VERSION

  let dbOk = true
  try {
    await storage.listUsers({ limit: 0 })
  } catch {
    dbOk = false
  }

  return {
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk,
    scheduler: scheduler.status(),
    uptime: uptime(),
    version,
    ts: Date.now(),
  }
}

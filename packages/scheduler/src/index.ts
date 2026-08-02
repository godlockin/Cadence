/**
 * @pulsedeck/scheduler — Cron + Cloudflare DO Alarm adapter.
 * PHASE 0: interface skeletons.
 */
import type { Schedule } from '@pulsedeck/domain'
import type { StorageAdapter } from '@pulsedeck/storage'

export interface SchedulerTick {
  readonly due: readonly Schedule[]
  readonly polledAt: Date
}

export interface SchedulerPort {
  /** compute next fire time for a schedule */
  next(schedule: Schedule, from: Date): Date | null
  /** start polling loop, emitting ticks via callback */
  start(storage: StorageAdapter, onTick: (tick: SchedulerTick) => Promise<void>): Promise<void>
  /** stop the loop gracefully */
  stop(): Promise<void>
}

export interface DurableObjectAlarmPort {
  /** schedule the next DO alarm for `scheduleId` at `at` */
  schedule(scheduleId: string, at: Date): Promise<void>
  /** cancel the upcoming alarm */
  cancel(scheduleId: string): Promise<void>
}

export const VERSION = '0.1.0'

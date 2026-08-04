/**
 * Dev-only standalone cron loop.
 *
 * Polls the shared SQLite file for due cron tasks and enqueues an Execution
 * row per due task (status `queued`), which the `dev:queue` worker picks up.
 *
 * Production Node deployments do NOT need this process — they set
 * `PULSEDECK_SCHEDULER_ENABLED=1` and the scheduler runs inside the API
 * process (see `apps/api/src/adapters/node.ts`).
 */
import { ulid } from 'ulid'
import { SchedulerHandle, type TriggerFn } from '@cadence/scheduler'
import { openDevStorage } from './dev-shared.js'

const { storage, close } = openDevStorage()

const triggerFn: TriggerFn = async (taskId, ctx) => {
  const task = await storage.getTask(taskId)
  if (task === null) return null
  const now = Date.now()
  const executionId = ulid() as never
  await storage.createExecution({
    id: executionId,
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

const handle = new SchedulerHandle({
  storage,
  triggerFn,
  /* Long-running local process — keep the cron poller alive (Cloudflare's
   * 60s CPU-bound default is too short for a standalone loop). */
  cron: { maxRunMs: 24 * 60 * 60 * 1000 },
})
await handle.start(storage).catch((err: unknown) => {
  console.error('[dev:cron] failed to start', err instanceof Error ? err.message : String(err))
})

console.log('[dev:cron] scheduler cron loop running (Ctrl+C to stop)')

const shutdown = async (): Promise<void> => {
  console.log('[dev:cron] stopping')
  await handle.stop().catch(() => {})
  await close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

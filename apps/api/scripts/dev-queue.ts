/**
 * Dev-only standalone queue consumer.
 *
 * Polls the shared SQLite file for executions stuck in `queued` and runs
 * them through a no-op runner (`queued → running → success`). This is a
 * scaffold so `pnpm dev` ships all four processes (api / web / cron /
 * queue) and executions created by the cron loop visibly complete.
 *
 * Production execution dispatch is owned by `@cadence/sinker`
 * (`SinkerEngine`), wired inside the API process.
 */
import { openDevStorage } from './dev-shared.js'

const { storage, close } = openDevStorage()

const POLL_MS = 2000
const BATCH = 10

async function tick(): Promise<void> {
  const queued = await storage.listExecutions({ status: 'queued', limit: BATCH })
  for (const exec of queued) {
    const startedAt = Date.now()
    const running = await storage.updateExecution(exec.id, {
      status: 'running',
      startedAt,
      expectedVersion: exec.version,
    })
    const finishedAt = Date.now()
    await storage.updateExecution(exec.id, {
      status: 'success',
      finishedAt,
      durationMs: finishedAt - startedAt,
      resultJson: JSON.stringify({
        note: 'dev queue worker — no-op execution',
        executionId: exec.id,
      }),
      expectedVersion: running.version,
    })
    console.log(`[dev:queue] execution ${exec.id} → success (no-op dev runner)`)
  }
}

console.log(`[dev:queue] queue consumer running (polls queued executions every ${POLL_MS.toString()}ms)`)
void tick().catch((err: unknown) => {
  console.error('[dev:queue] initial tick failed', err instanceof Error ? err.message : String(err))
})
const timer = setInterval(() => {
  void tick().catch((err: unknown) => {
    console.error('[dev:queue] tick failed', err instanceof Error ? err.message : String(err))
  })
}, POLL_MS)

const shutdown = async (): Promise<void> => {
  clearInterval(timer)
  await close()
  process.exit(0)
}
process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())

/**
 * scheduler-latency.bench.ts — cron nextFireAt + triggerTask latency.
 *
 * Measures:
 *  - parseCron().next() latency
 *  - triggerTask (skip policy, no active execs) latency
 *  - triggerTask (skip policy, with active exec → skip) latency
 *
 * Run with: npx tsx bench/scheduler-latency.bench.ts
 */
import { ulid } from 'ulid'
import { performance } from 'node:perf_hooks'
import { parseCron, nextFireAt, triggerTask } from '../packages/scheduler/src/index.js'
import { FakeSinker } from '../packages/scheduler/test/fakes.js'
import { buildTask } from '../packages/scheduler/test/helpers.js'
import { InMemoryStorageAdapter } from '../packages/storage/src/in-memory.js'

const RUNS = 5
const ITER = 1000

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

function stats(name: string, runs: number[], n: number) {
  const opsPerSec = runs.map((ms) => (n / ms) * 1000)
  const ops = median(opsPerSec)
  const p50 = median(runs)
  console.log(`  ${name.padEnd(50)} ${ops.toLocaleString().padStart(8)} ops/s   p50=${p50.toFixed(3)}ms`)
}

async function main() {
  console.log('\n=== Scheduler Latency Benchmarks ===\n')
  console.log(`  ${ITER} iterations, ${RUNS} runs, median reported\n`)

  const storage = new InMemoryStorageAdapter()
  const sinker = new FakeSinker()

  const task = buildTask({ concurrency_policy: 'skip' })
  await storage.saveTask(task)

  // Pre-seed 1 running execution (for skip-with-active test)
  await storage.createExecution({
    id: '01ABENCHXXXXXXXXXXXXXXXXX' as Parameters<typeof storage.createExecution>[0]['id'],
    taskId: task.id,
    status: 'running',
    triggerSource: 'manual',
    triggeredBy: null,
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  })

  // Warmup
  const schedule = { expression: '*/5 * * * *', timezone: 'UTC' }
  parseCron(schedule).next(Date.now(), 1)
  nextFireAt(schedule)
  triggerTask(storage, sinker.asTriggerFn(), task.id, { source: 'cron', triggeredBy: 'bench', payload: {} }, 'bench', { now: () => Date.now() })

  // parseCron().next()
  const nextRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) {
      parseCron(schedule).next(Date.now(), 1)
    }
    nextRuns.push(performance.now() - t0)
  }

  // nextFireAt
  const fireAtRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) {
      nextFireAt(schedule)
    }
    fireAtRuns.push(performance.now() - t0)
  }

  // triggerTask (no active → allow)
  const allowRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    sinker.reset()
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) {
      await triggerTask(storage, sinker.asTriggerFn(), task.id, { source: 'cron', triggeredBy: 'bench', payload: {} }, 'bench', { now: () => Date.now() })
    }
    allowRuns.push(performance.now() - t0)
  }

  // triggerTask (with active → skip)
  const skipRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    sinker.reset()
    // Use unique exec ID per run to avoid ConflictError
    await storage.createExecution({
      id: `bench-skip-${r}` as Parameters<typeof storage.createExecution>[0]['id'],
      taskId: task.id,
      status: 'running',
      triggerSource: 'manual',
      triggeredBy: null,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: null,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) {
      await triggerTask(storage, sinker.asTriggerFn(), task.id, { source: 'cron', triggeredBy: 'bench', payload: {} }, 'bench', { now: () => Date.now() })
    }
    skipRuns.push(performance.now() - t0)
  }

  stats('parseCron().next() (N calls)', nextRuns, ITER)
  stats('nextFireAt() (N calls)', fireAtRuns, ITER)
  stats('triggerTask (skip policy, allow)', allowRuns, ITER)
  stats('triggerTask (skip policy, skip)', skipRuns, ITER)
  console.log('')
}

main().catch(console.error)

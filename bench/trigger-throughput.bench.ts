/**
 * trigger-throughput.bench.ts — task trigger throughput benchmark.
 */
import { performance } from 'node:perf_hooks'
import { InMemoryStorageAdapter } from '../packages/storage/src/in-memory.js'
import { EmbeddedQueueAdapter } from '../packages/queue/src/embedded.js'
import type { QueueItem, TaskId, ExecutionId } from '../packages/domain/src/index.js'

const RUNS = 5
const N = 1000

let _counter = 0
function nextId(): string {
  return `bench-${String(_counter++).padStart(10, '0')}`
}

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

function makeQueueItem(): QueueItem {
  return {
    taskId: nextId() as TaskId,
    executionId: nextId() as ExecutionId,
    context: { source: 'manual', triggeredBy: 'bench', payload: {} },
    enqueuedAt: Date.now(),
  }
}

async function main() {
  console.log('\n=== Trigger / Queue Throughput Benchmarks ===\n')
  console.log(`  N=${N} items, ${RUNS} runs, median reported\n`)

  // --- InMemory queue enqueue throughput ---
  const queue = new EmbeddedQueueAdapter()
  const warmItem = makeQueueItem()
  for (let i = 0; i < 100; i++) await queue.enqueue(warmItem)
  await queue.dequeue()

  const enqRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    await queue.dequeue() // drain
    const items = Array.from({ length: N }, () => makeQueueItem())
    const t0 = performance.now()
    for (const item of items) await queue.enqueue(item)
    enqRuns.push(performance.now() - t0)
  }

  // --- InMemory queue dequeue throughput ---
  const deqRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const items = Array.from({ length: N }, () => makeQueueItem())
    for (const item of items) await queue.enqueue(item)
    const t0 = performance.now()
    for (let i = 0; i < N; i++) await queue.dequeue()
    deqRuns.push(performance.now() - t0)
  }

  // --- InMemory storage ---
  const storage = new InMemoryStorageAdapter()
  const taskId = nextId() as TaskId
  await storage.saveTask({
    id: taskId,
    name: 'bench-task',
    description: null,
    owner_id: nextId(),
    group_id: null,
    payload_kind: 'manual',
    payload_json: '{}',
    trigger_kind: 'manual',
    trigger_config_json: '{}',
    status: 'scheduled',
    cron: null,
    timezone: 'UTC',
    start_at: null,
    end_at: null,
    max_retries: 0,
    retry_backoff: 'exponential',
    concurrency_policy: 'skip',
    jitter_ms: 0,
    timeout_ms: 30000,
    tags: [],
    notifications_json: null,
    metadata_json: '{}',
    version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  })

  // Warmup
  for (let i = 0; i < 100; i++) {
    await storage.listTasks({})
    await storage.getTask(taskId)
  }

  const listRuns: number[] = []
  const getRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < N; i++) await storage.listTasks({})
    listRuns.push(performance.now() - t0)

    const t1 = performance.now()
    for (let i = 0; i < N; i++) await storage.getTask(taskId)
    getRuns.push(performance.now() - t1)
  }

  stats('EmbeddedQueueAdapter enqueue (N)', enqRuns, N)
  stats('EmbeddedQueueAdapter dequeue (N)', deqRuns, N)
  stats('InMemory listTasks (N queries)', listRuns, N)
  stats('InMemory getTask (N queries)', getRuns, N)
  console.log('')
}

main().catch(console.error)

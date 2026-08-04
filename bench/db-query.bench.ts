/**
 * db-query.bench.ts — storage adapter query benchmarks.
 */
import { performance } from 'node:perf_hooks'
import { InMemoryStorageAdapter } from '../packages/storage/src/in-memory.js'
import type { TaskId, ExecutionId } from '../packages/domain/src/index.js'

const RUNS = 5
const ITER = 1000

let _ctr = 0
function id(): string {
  return `b${String(_ctr++).padStart(12, '0')}`
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

async function main() {
  console.log('\n=== Storage Query Benchmarks ===\n')
  console.log(`  N=${ITER} iterations, ${RUNS} runs, median reported\n`)

  const storage = new InMemoryStorageAdapter()
  const seedTaskId = id() as TaskId

  // Seed ITER tasks
  for (let i = 0; i < ITER; i++) {
    await storage.saveTask({
      id: id() as TaskId,
      name: `task-${i}`,
      description: null,
      owner_id: id(),
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
  }

  // Seed ITER executions
  for (let i = 0; i < ITER; i++) {
    await storage.createExecution({
      id: id() as ExecutionId,
      taskId: seedTaskId,
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
  }

  // Warmup
  for (let i = 0; i < 100; i++) {
    await storage.listTasks({})
    await storage.listExecutions({ taskId: seedTaskId })
  }

  // listTasks no filter
  const listAllRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) await storage.listTasks({})
    listAllRuns.push(performance.now() - t0)
  }

  // listTasks with status filter
  const listFiltRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) await storage.listTasks({ status: 'scheduled' })
    listFiltRuns.push(performance.now() - t0)
  }

  // listExecutions no filter
  const listExecRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) await storage.listExecutions({})
    listExecRuns.push(performance.now() - t0)
  }

  // listExecutions with taskId filter
  const listExecTaskRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    for (let i = 0; i < ITER; i++) await storage.listExecutions({ taskId: seedTaskId })
    listExecTaskRuns.push(performance.now() - t0)
  }

  stats(`InMemory listTasks (${ITER} rows, no filter)`, listAllRuns, ITER)
  stats(`InMemory listTasks (${ITER} rows, status filter)`, listFiltRuns, ITER)
  stats(`InMemory listExecutions (${ITER} rows, no filter)`, listExecRuns, ITER)
  stats(`InMemory listExecutions (${ITER} rows, taskId filter)`, listExecTaskRuns, ITER)
  console.log('')
}

main().catch(console.error)

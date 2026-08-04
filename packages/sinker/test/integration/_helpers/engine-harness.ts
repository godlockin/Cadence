/**
 * @cadence/sinker — engine harness for integration tests.
 *
 * Wires SinkerEngine against:
 *  - PHASE 2 storage (InMemoryStorageAdapter from @cadence/storage)
 *    via the SinkerStorageAdapter bridge.
 *  - EmbeddedQueueAdapter from @cadence/queue (engine controls dequeue).
 *  - FakeExecutor (scriptable, no external IO).
 *  - FakeScheduler, FakeNotifier, BufferedLogger.
 *
 * Each test gets a fresh harness. Call `runUntilDrained()` to drive the
 * worker loop until the queue is empty, then `stop()` to clean up.
 */
import { SinkerEngine, PayloadDispatcher, BufferedLogger } from '../../../src/index.js'
import { HttpHandler } from '../../../src/handlers/http.js'
import { CommandHandler } from '../../../src/handlers/command.js'
import { WebhookHandler } from '../../../src/handlers/webhook.js'
import { PipelineHandler } from '../../../src/handlers/pipeline.js'
import { FakeExecutor, type ExecutorScript } from '../../fixtures/fake-executor.js'
import { FakeScheduler } from '../../fixtures/fake-scheduler.js'
import { FakeNotifier } from '../../fixtures/fake-notifier.js'
import { SinkerStorageAdapter } from '../../fixtures/sinker-storage-bridge.js'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { EmbeddedQueueAdapter } from '@cadence/queue'
import type { QueueAdapter } from '../../../src/index.js'

export interface HarnessOpts {
  /** Override the executor script. Default: 5ms sleep. */
  executorScript?: ExecutorScript
  /** Register an extra handler in the dispatcher (besides the 4 built-ins). */
  extraHandlers?: boolean
}

export interface Harness {
  engine: SinkerEngine
  storage: SinkerStorageAdapter
  phase2Storage: InMemoryStorageAdapter
  queue: EmbeddedQueueAdapter
  executor: FakeExecutor
  scheduler: FakeScheduler
  notifier: FakeNotifier
  logger: BufferedLogger
  dispatcher: PayloadDispatcher
  /** AbortController for the worker loop. */
  workerAbort: AbortController
  /** Promise of the running worker loop. */
  workerPromise: Promise<void>
  /** Spin the worker loop until queue is empty. */
  runUntilDrained: (timeoutMs?: number) => Promise<void>
  /** Stop the worker loop and wait for it to exit. */
  stop: () => Promise<void>
}

export function makeHarness(opts: HarnessOpts = {}): Harness {
  const phase2Storage = new InMemoryStorageAdapter()
  const storage = new SinkerStorageAdapter(phase2Storage)
  const queue = new EmbeddedQueueAdapter()
  const scheduler = new FakeScheduler()
  const notifier = new FakeNotifier()
  const logger = new BufferedLogger()
  const dispatcher = new PayloadDispatcher({ logger })
    .register(new HttpHandler())
    .register(new CommandHandler())
    .register(new WebhookHandler())
    .register(new PipelineHandler())
  const executor = new FakeExecutor(
    opts.executorScript ??
      (async (_task, _exec, _trigger, signal) => {
        await new Promise<void>((resolve) => {
          const id = setTimeout(resolve, 5)
          signal.addEventListener('abort', () => clearTimeout(id), { once: true })
        })
      }),
  )
  const engine = new SinkerEngine({
    storage,
    queue,
    executor,
    scheduler,
    notifier,
    logger,
    dispatcher,
    runtime: 'local',
  })

  const workerAbort = new AbortController()
  const workerPromise = engine.workerLoop('test-worker', workerAbort.signal)

  const runUntilDrained = async (timeoutMs = 5000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    while ((await (queue as unknown as QueueAdapter).size()) > 0) {
      if (Date.now() > deadline) {
        throw new Error(`runUntilDrained: queue not empty after ${timeoutMs}ms`)
      }
      await new Promise((r) => setTimeout(r, 10))
    }
    /* Give the in-flight execution a tick to finalise. */
    await new Promise((r) => setTimeout(r, 20))
  }

  const stop = async (): Promise<void> => {
    workerAbort.abort()
    try {
      await workerPromise
    } catch {
      /* abort: expected */
    }
    await phase2Storage.close()
  }

  return {
    engine,
    storage,
    phase2Storage,
    queue,
    executor,
    scheduler,
    notifier,
    logger,
    dispatcher,
    workerAbort,
    workerPromise,
    runUntilDrained,
    stop,
  }
}

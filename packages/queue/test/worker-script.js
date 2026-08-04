/**
 * Minimal worker entry used by LocalQueueAdapter tests.
 * Echoes workerData back and exits cleanly.
 */
import { parentPort, workerData } from 'node:worker_threads'

if (parentPort) {
  parentPort.postMessage({ ok: true, echo: workerData })
}
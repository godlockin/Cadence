/**
 * benchmark.ts — shared runner for Cadence micro-benchmarks.
 *
 * Usage:
 *   pnpm bench:run          # all benches
 *   npx tsx bench/credential-encrypt.bench.ts
 *
 * Each bench exports a `run()` function that reports:
 *   ops/sec, p50, p95, p99 latency (ms)
 *
 * Run each bench 5 times, take the median to reduce variance.
 */
import { performance } from 'node:perf_hooks'

export interface BenchResult {
  name: string
  opsPerSec: number
  p50: number
  p95: number
  p99: number
  samples: number
}

export async function benchmark(
  name: string,
  fn: () => unknown,
  iterations: number,
  warmup = 100,
): Promise<BenchResult> {
  // Warmup
  for (let i = 0; i < warmup; i++) await fn()

  const latencies: number[] = []
  const start = performance.now()
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await fn()
    latencies.push(performance.now() - t0)
  }
  const totalMs = performance.now() - start

  latencies.sort((a, b) => a - b)
  const p = (pct: number) => {
    const idx = Math.floor((pct / 100) * latencies.length)
    return latencies[Math.min(idx, latencies.length - 1)] ?? 0
  }

  return {
    name,
    opsPerSec: Math.round((iterations / totalMs) * 1000),
    p50: Math.round(p(50) * 1000) / 1000,
    p95: Math.round(p(95) * 1000) / 1000,
    p99: Math.round(p(99) * 1000) / 1000,
    samples: iterations,
  }
}

export function report(result: BenchResult): void {
  console.log(
    `  ${result.name.padEnd(40)} ${result.opsPerSec.toLocaleString().padStart(8)} ops/s  ` +
    `p50=${result.p50.toFixed(3)}ms  p95=${result.p95.toFixed(3)}ms  p99=${result.p99.toFixed(3)}ms`,
  )
}

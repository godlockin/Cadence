/**
 * credential-encrypt.bench.ts — AES-256-GCM encryption benchmark.
 *
 * Measures:
 *  - encrypt ops/sec
 *  - decrypt ops/sec
 *  - key derivation cost
 */
import { randomBytes } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { createCredentialCipher } from '../packages/auth/src/credential-crypto.js'

const KEY = randomBytes(32)
const PLAINTEXT = 'super-secret-oauth-refresh-token-1234567890'
const RUNS = 5

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]!
}

async function benchEncrypt(iterations: number) {
  const cipher = createCredentialCipher(KEY)
  const latencies: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await cipher.encrypt(PLAINTEXT)
    latencies.push(performance.now() - t0)
  }
  return latencies
}

async function benchDecrypt(iterations: number) {
  const cipher = createCredentialCipher(KEY)
  const enc = await cipher.encrypt(PLAINTEXT)
  const latencies: number[] = []
  for (let i = 0; i < iterations; i++) {
    const t0 = performance.now()
    await cipher.decrypt(enc)
    latencies.push(performance.now() - t0)
  }
  return latencies
}

function stats(name: string, runs: number[], opsPerRun: number) {
  const durations = runs.map((ms) => (opsPerRun / ms) * 1000)
  const p50 = median(runs)
  const ops = median(durations)
  console.log(`  ${name.padEnd(40)} ${ops.toLocaleString().padStart(8)} ops/s   p50=${p50.toFixed(3)}ms`)
}

async function main() {
  console.log('\n=== AES-256-GCM Credential Encryption Benchmarks ===\n')
  console.log('  setup: 1000 iterations, 5 runs, median reported\n')

  const ITER = 1000
  const WARMUP = 100

  // Warmup
  const warmCipher = createCredentialCipher(KEY)
  for (let i = 0; i < WARMUP; i++) await warmCipher.encrypt(PLAINTEXT)

  // Encrypt
  const encRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    await benchEncrypt(ITER)
    encRuns.push(performance.now() - t0)
  }

  // Warmup decrypt
  const warmEnc = await warmCipher.encrypt(PLAINTEXT)
  for (let i = 0; i < WARMUP; i++) await warmCipher.decrypt(warmEnc)

  // Decrypt
  const decRuns: number[] = []
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now()
    await benchDecrypt(ITER)
    decRuns.push(performance.now() - t0)
  }

  stats('AES-GCM encrypt', encRuns, ITER)
  stats('AES-GCM decrypt', decRuns, ITER)
  console.log('')
}

main().catch(console.error)

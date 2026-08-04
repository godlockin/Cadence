/**
 * @cadence/scheduler — RetryPolicy.
 *
 * Computes the delay between retries based on Task.max_retries and
 * Task.retry_backoff ('fixed' | 'exponential'). Tests can override the
 * clock + base.
 */
import type { Task } from '@cadence/domain'

export type RetryDecision =
  | { readonly kind: 'no_retry'; readonly attempt: number }
  | { readonly kind: 'retry'; readonly attempt: number; readonly delayMs: number }

export interface RetryPolicyOptions {
  /** Base delay in ms. exponential uses this as initial. Default 100. */
  readonly baseDelayMs?: number
  /** Maximum cap on backoff. Default 60000. */
  readonly maxDelayMs?: number
  /** Jitter multiplier (0..1). Default 0.0 (no jitter). */
  readonly jitter?: number
  /** Override RNG for tests. */
  readonly random?: () => number
}

export class RetryPolicy {
  private readonly baseDelayMs: number
  private readonly maxDelayMs: number
  private readonly jitter: number
  private readonly random: () => number

  constructor(opts: RetryPolicyOptions = {}) {
    this.baseDelayMs = opts.baseDelayMs ?? 100
    this.maxDelayMs = opts.maxDelayMs ?? 60_000
    this.jitter = opts.jitter ?? 0
    this.random = opts.random ?? Math.random
  }

  /**
   * Decide whether to retry a failed execution, and with what delay.
   *
   *   attempt=0 — first execution
   *   attempt=1 — first retry (after attempt 0 failed)
   *   ...
   */
  decide(task: Task, attempt: number): RetryDecision {
    const max = task.max_retries
    if (max <= 0 || attempt > max) return { kind: 'no_retry', attempt }
    const delayMs = this.delayFor(task, attempt)
    return { kind: 'retry', attempt: attempt + 1, delayMs }
  }

  delayFor(task: Task, attempt: number): number {
    const base = this.baseDelayMs
    const cap = Math.min(this.maxDelayMs, Number.MAX_SAFE_INTEGER)
    let raw: number
    if (task.retry_backoff === 'fixed') {
      raw = base
    } else {
      /* exponential: base * 2^(attempt-1) */
      const exp = Math.max(0, attempt - 1)
      raw = Math.min(cap, base * 2 ** exp)
    }
    if (this.jitter > 0) {
      const j = this.random() * this.jitter
      raw = Math.round(raw * (1 + j))
    }
    return Math.max(0, Math.min(cap, Math.round(raw)))
  }
}

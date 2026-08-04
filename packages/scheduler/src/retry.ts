/**
 * @cadence/scheduler — RetryPolicy helper (nextRetryDelay).
 *
 * Compute delay (in ms) between failed executions based on the task's
 * `retry_backoff` setting. Backoff is exponential by default with jitter
 * to avoid thundering-herd when a downstream service is restarting.
 *
 *   nextRetryDelay(0, 'fixed')       → baseMs (e.g. 1000)
 *   nextRetryDelay(1, 'exponential') → baseMs * 2 + jitter (0..1000)
 *   nextRetryDelay(5, 'exponential') → min(maxMs, baseMs * 32 + jitter)
 *
 * `attempt` is zero-based — attempt=0 means "the first retry AFTER the
 * original execution failed".
 */
export type RetryBackoff = 'fixed' | 'exponential'

export interface RetryDelayOptions {
  /** base delay (ms). Default 1000. */
  readonly baseMs?: number
  /** ceiling (ms). Default 60_000. */
  readonly maxMs?: number
  /** random source — overrides Math.random for deterministic tests. */
  readonly random?: () => number
  /** additional jitter spread (ms) added at the END. Default 1000. */
  readonly jitterMs?: number
}

export function nextRetryDelay(
  attempt: number,
  backoff: RetryBackoff,
  opts: RetryDelayOptions = {},
): number {
  const baseMs = opts.baseMs ?? 1_000
  const maxMs = opts.maxMs ?? 60_000
  const jitterMs = opts.jitterMs ?? 1_000
  const random = opts.random ?? Math.random
  const safeAttempt = Number.isFinite(attempt)
    ? Math.max(0, Math.floor(attempt))
    : Number.MAX_SAFE_INTEGER

  let raw: number
  if (backoff === 'fixed') {
    raw = baseMs
  } else {
    const exp = Math.min(baseMs * 2 ** safeAttempt, maxMs)
    raw = exp + random() * jitterMs
  }
  if (raw < 0) return 0
  if (raw > maxMs + jitterMs) return maxMs + jitterMs
  return Math.round(raw)
}

/**
 * @cadence/scheduler — retry nextRetryDelay unit tests.
 *
 * Covers:
 *  - fixed backoff (constant baseMs)
 *  - exponential backoff doubling + jitter
 *  - cap at maxMs
 *  - attempts that overflow Number preserve safety
 *  - jitter is bounded (returns within [base, base + jitterMs])
 *  - inject deterministic RNG
 */
import { describe, expect, it } from 'vitest'

import { nextRetryDelay } from '../src/index.js'

describe('nextRetryDelay — fixed', () => {
  it('returns baseMs regardless of attempt', () => {
    for (const a of [0, 1, 3, 7]) {
      expect(nextRetryDelay(a, 'fixed', { baseMs: 1500, jitterMs: 0 })).toBe(1500)
    }
  })
})

describe('nextRetryDelay — exponential', () => {
  it('doubles each attempt (modulo jitter)', () => {
    /* Use deterministic RNG = 0 to remove jitter. */
    const r = () => 0
    expect(nextRetryDelay(0, 'exponential', { baseMs: 1000, jitterMs: 0, random: r })).toBe(1000)
    expect(nextRetryDelay(1, 'exponential', { baseMs: 1000, jitterMs: 0, random: r })).toBe(2000)
    expect(nextRetryDelay(2, 'exponential', { baseMs: 1000, jitterMs: 0, random: r })).toBe(4000)
    expect(nextRetryDelay(3, 'exponential', { baseMs: 1000, jitterMs: 0, random: r })).toBe(8000)
  })

  it('caps at maxMs', () => {
    const r = () => 0
    /* baseMs=1000, maxMs=5000, attempt=10 → 1024000 capped to 5000. */
    expect(
      nextRetryDelay(10, 'exponential', { baseMs: 1000, maxMs: 5000, jitterMs: 0, random: r }),
    ).toBe(5000)
  })

  it('adds jitter in [0, jitterMs)', () => {
    /* RNG = 0.5 → 500 ms jitter. */
    const r = () => 0.5
    const delay = nextRetryDelay(1, 'exponential', { baseMs: 1000, jitterMs: 1000, random: r })
    expect(delay).toBeGreaterThanOrEqual(2500)
    expect(delay).toBeLessThanOrEqual(2501)
  })
})

describe('nextRetryDelay — defensive', () => {
  it('treats negative attempt as 0', () => {
    expect(
      nextRetryDelay(-5, 'fixed', { baseMs: 100, jitterMs: 0 }),
    ).toBe(100)
  })

  it('handles NaN attempt safely', () => {
    expect(
      nextRetryDelay(Number.NaN, 'fixed', { baseMs: 100, jitterMs: 0 }),
    ).toBe(100)
  })

  it('handles Infinity attempt (capped)', () => {
    const r = () => 0
    expect(
      nextRetryDelay(Number.POSITIVE_INFINITY, 'exponential', {
        baseMs: 1000,
        maxMs: 5000,
        jitterMs: 0,
        random: r,
      }),
    ).toBe(5000)
  })

  it('returns 0 floor on extreme defaults', () => {
    /* baseMs negative + fixed → Math.max(0, raw). We just confirm no
     * exception is thrown. */
    expect(
      nextRetryDelay(0, 'fixed', { baseMs: -10, jitterMs: 0 }),
    ).toBe(0)
  })

  it('caps final delay at maxMs + jitterMs', () => {
    const r = () => 1
    const delay = nextRetryDelay(20, 'exponential', {
      baseMs: 1000,
      maxMs: 5000,
      jitterMs: 1000,
      random: r,
    })
    expect(delay).toBeLessThanOrEqual(5000 + 1000)
  })
})

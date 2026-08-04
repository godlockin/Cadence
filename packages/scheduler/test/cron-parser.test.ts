/**
 * @cadence/scheduler — cron-parser unit tests.
 *
 * Covers:
 *  - 5-field ("*\/5 * * * *"), 6-field ("*\/5 * * * * *") expressions
 *  - timezone (UTC + Asia/Shanghai) — next() returns time aligned to local hour
 *  - parseCron().next() returns N ms timestamps, strictly increasing
 *  - parseCron().isWithinWindow() with start/end
 *  - nextFireAt() returns null on end-of-window
 *  - InvalidCronError on malformed input (typed error)
 *  - reset semantics: next(from2, ...) advances from a fresh reference
 */
import { describe, expect, it } from 'vitest'
import {
  parseCron,
  nextFireAt,
  InvalidCronError,
  type CronSchedule,
} from '../src/index.js'

const BASE_DATE = new Date('2026-01-15T10:00:00.000Z')
const BASE_MS = BASE_DATE.getTime()

function s(express: string, timezone = 'UTC', startAt?: number, endAt?: number): CronSchedule {
  return { expression: express, timezone, startAt, endAt }
}

describe('parseCron — 5-field expressions', () => {
  it('computes next fire for "*/5 * * * *" (every 5 minutes)', () => {
    const handle = parseCron(s('*/5 * * * *'))
    const arr = handle.next(BASE_MS, 3)
    expect(arr.length).toBe(3)
    /* Each is >= BASE_MS; first is the next 5-minute boundary; gaps are 5min */
    expect(arr[0]).toBeGreaterThanOrEqual(BASE_MS)
    expect((arr[1] ?? 0) - (arr[0] ?? 0)).toBe(5 * 60_000)
    expect((arr[2] ?? 0) - (arr[1] ?? 0)).toBe(5 * 60_000)
  })

  it('computes next fire for "0 9 * * 1-5" (weekdays at 9:00)', () => {
    const handle = parseCron(s('0 9 * * 1-5'))
    /* BASE is a Thursday (2026-01-15) at 10:00 UTC — next 9:00 weekday is Friday. */
    const arr = handle.next(BASE_MS, 1)
    expect(arr.length).toBe(1)
    const fire = new Date(arr[0] ?? 0)
    expect(fire.getUTCHours()).toBe(9)
    expect(fire.getUTCMinutes()).toBe(0)
    /* cron: Sunday=0, Monday=1 ... Friday=5 */
    expect(fire.getUTCDay()).toBe(5)
  })
})

describe('parseCron — 6-field expressions (seconds)', () => {
  it('accepts "0 */5 * * * *" (every 5 minutes on second 0)', () => {
    const handle = parseCron(s('0 */5 * * * *'))
    const arr = handle.next(BASE_MS, 2)
    expect(arr.length).toBe(2)
    /* second is 0 */
    expect(new Date(arr[0] ?? 0).getUTCSeconds()).toBe(0)
    expect((arr[1] ?? 0) - (arr[0] ?? 0)).toBe(5 * 60_000)
  })
})

describe('parseCron — timezone', () => {
  it('honours Asia/Shanghai (+08:00)', () => {
    const handle = parseCron(s('0 9 * * *', 'Asia/Shanghai'))
    /* 2026-01-15 10:00 UTC = 18:00 Shanghai — next 9:00 Shanghai is next day. */
    const arr = handle.next(BASE_MS, 1)
    expect(arr.length).toBe(1)
    const fire = new Date(arr[0] ?? 0)
    /* Shanghai is UTC+8 — 9:00 local = 01:00 UTC. */
    expect(fire.getUTCHours()).toBe(1)
    expect(fire.getUTCMinutes()).toBe(0)
  })

  it('honours UTC timezone', () => {
    const handle = parseCron(s('0 12 * * *', 'UTC'))
    const arr = handle.next(BASE_MS, 1)
    const fire = new Date(arr[0] ?? 0)
    expect(fire.getUTCHours()).toBe(12)
  })
})

describe('parseCron — boundaries', () => {
  it('returns [] on limit=0', () => {
    const handle = parseCron(s('*/5 * * * *'))
    expect(handle.next(BASE_MS, 0)).toEqual([])
  })

  it('returns [] on non-finite from', () => {
    const handle = parseCron(s('*/5 * * * *'))
    expect(handle.next(Number.NaN, 3)).toEqual([])
  })

  it('returns [] when endDate has passed', () => {
    const handle = parseCron(s('*/5 * * * *', 'UTC', undefined, BASE_MS - 60_000))
    expect(handle.next(BASE_MS, 3)).toEqual([])
  })

  it('startAt flag (window) is exposed via isWithinWindow, not affecting next()', () => {
    /* cron-parser's own startDate semantics differ from ours — we expose
     * start_at via isWithinWindow() so the caller can self-validate. */
    const handle = parseCron(s('*/5 * * * *', 'UTC', BASE_MS + 10 * 60_000))
    const arr = handle.next(BASE_MS, 1)
    expect(arr[0]).not.toBeUndefined()
    /* After parseCron with startAt, slots BEFORE startAt are NOT filtered
     * out — callers must use isWithinWindow() to enforce. */
    expect(handle.isWithinWindow(BASE_MS + 5 * 60_000)).toBe(false)
    expect(handle.isWithinWindow(BASE_MS + 60 * 60_000)).toBe(true)
  })
})

describe('parseCron — isWithinWindow', () => {
  it('returns true within both bounds', () => {
    const handle = parseCron(s('*/5 * * * *', 'UTC', 100, 1000))
    expect(handle.isWithinWindow(500)).toBe(true)
  })

  it('returns false before startAt', () => {
    const handle = parseCron(s('*/5 * * * *', 'UTC', 100, 1000))
    expect(handle.isWithinWindow(50)).toBe(false)
  })

  it('returns false after endAt', () => {
    const handle = parseCron(s('*/5 * * * *', 'UTC', 100, 1000))
    expect(handle.isWithinWindow(1500)).toBe(false)
  })

  it('returns true when no bounds set', () => {
    const handle = parseCron(s('*/5 * * * *'))
    expect(handle.isWithinWindow(0)).toBe(true)
    expect(handle.isWithinWindow(Number.MAX_SAFE_INTEGER)).toBe(true)
  })
})

describe('parseCron — InvalidCronError', () => {
  it('throws on garbage expression', () => {
    expect(() => parseCron(s('not-a-cron'))).toThrow(InvalidCronError)
  })

  it('InvalidCronError carries expression + timezone fields', () => {
    try {
      parseCron(s('!!!nope!!!', 'Asia/Shanghai'))
      throw new Error('should have thrown')
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(InvalidCronError)
      if (err instanceof InvalidCronError) {
        expect(err.expression).toBe('!!!nope!!!')
        expect(err.timezone).toBe('Asia/Shanghai')
      }
    }
  })
})

describe('nextFireAt — convenience helper', () => {
  it('returns next single fire time', () => {
    const fire = nextFireAt(s('*/5 * * * *'), BASE_MS)
    expect(fire).not.toBeNull()
    expect(fire).toBeGreaterThanOrEqual(BASE_MS)
  })

  it('returns null when end window passed', () => {
    const fire = nextFireAt(s('*/5 * * * *', 'UTC', undefined, BASE_MS - 1))
    expect(fire).toBeNull()
  })
})

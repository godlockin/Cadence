/**
 * @cadence/scheduler — cron-parser wrapper.
 *
 * Thin façade over `cron-parser` so the rest of the package does not
 * depend on the library's mutable `CronExpression` object. Consumers
 * receive a fresh, immutable `NextOccurrences` handle from `parseCron`.
 *
 * Semantics:
 *  - `next(from, limit)` returns absolute ms timestamps for the next `limit`
 *    occurrences strictly AFTER `from` (caller decides whether to dedup).
 *  - `isWithinWindow(at)` honours `Task.start_at` / `Task.end_at`.
 *  - Invalid expressions throw a typed `InvalidCronError` so callers can
 *    log structured fields.
 */
import cronParser from 'cron-parser'

export interface CronSchedule {
  /** Standard cron: "*\/5 * * * *" or "0 9 * * 1-5".
   *  6-field with seconds is also accepted by cron-parser. */
  readonly expression: string
  /** IANA timezone identifier (e.g. "UTC", "Asia/Shanghai"). */
  readonly timezone: string
  /** Optional ms-epoch lower bound; matches Task.start_at. */
  readonly startAt?: number
  /** Optional ms-epoch upper bound; matches Task.end_at. */
  readonly endAt?: number
}

export interface NextOccurrences {
  /** next `limit` occurrences strictly > `from`. */
  next(from: number, limit: number): readonly number[]
  /** Is `at` within `[startAt, endAt]`? Always true when both unset. */
  isWithinWindow(at: number): boolean
}

/** Thrown when the cron expression cannot be parsed. */
export class InvalidCronError extends Error {
  public readonly expression: string
  public readonly timezone: string
  constructor(expression: string, timezone: string, cause: unknown) {
    const msg = cause instanceof Error ? cause.message : String(cause)
    super(`Invalid cron expression '${expression}' (tz=${timezone}): ${msg}`)
    this.name = 'InvalidCronError'
    this.expression = expression
    this.timezone = timezone
  }
}

export function parseCron(schedule: CronSchedule): NextOccurrences {
  let interval: cronParser.CronExpression
  try {
    interval = cronParser.parseExpression(schedule.expression, {
      currentDate: new Date(),
      tz: schedule.timezone,
      endDate: schedule.endAt !== undefined ? new Date(schedule.endAt) : undefined,
      startDate: schedule.startAt !== undefined ? new Date(schedule.startAt) : undefined,
    })
  } catch (err: unknown) {
    throw new InvalidCronError(schedule.expression, schedule.timezone, err)
  }

  return {
    next(from: number, limit: number): readonly number[] {
      if (!Number.isFinite(from)) return []
      if (!Number.isInteger(limit) || limit <= 0) return []
      interval.reset(new Date(from))
      const out: number[] = []
      for (let i = 0; i < limit; i++) {
        try {
          const next = interval.next()
          const ts = next.toDate().getTime()
          /* Honour the schedule window even if cron-parser ignores endDate
           * in some edge cases — fail-safe. */
          if (schedule.endAt !== undefined && ts > schedule.endAt) break
          out.push(ts)
        } catch {
          break
        }
      }
      return out
    },
    isWithinWindow(at: number): boolean {
      if (schedule.startAt !== undefined && at < schedule.startAt) return false
      if (schedule.endAt !== undefined && at > schedule.endAt) return false
      return true
    },
  }
}

/**
 * Convenience: compute the next single fire time for a schedule.
 * Returns null if there are no upcoming fires or the expression is invalid.
 */
export function nextFireAt(schedule: CronSchedule, from: number = Date.now()): number | null {
  const handle = parseCron(schedule)
  const [first] = handle.next(from, 1)
  return first ?? null
}

/**
 * Cron expression utilities for human-readable conversion and next occurrence calculation.
 */
import cronstrue from 'cronstrue'

/**
 * Convert cron expression to human-readable description.
 */
export function cronToHuman(cron: string, _timezone?: string): string {
  if (!cron) return ''
  try {
    return cronstrue.toString(cron, { locale: 'en', use24HourTimeFormat: true, verbose: true })
  } catch {
    return cron
  }
}

/**
 * Build a cron expression from simple options.
 */
export type Frequency = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'custom'

export interface CronOptions {
  frequency: Frequency
  hour?: number
  minute?: number
  daysOfWeek?: number[] // 0=Sun, 1=Mon, ..., 6=Sat
  dayOfMonth?: number
  custom?: string
}

export function buildCron(options: CronOptions): string {
  const minute = String(options.minute ?? 0).padStart(2, '0')
  const hour = String(options.hour ?? 9).padStart(2, '0')

  switch (options.frequency) {
    case 'hourly':
      return `${minute} * * * *`
    case 'daily':
      return `${minute} ${hour} * * *`
    case 'weekly': {
      const days = (options.daysOfWeek ?? [1]).sort().join(',')
      return `${minute} ${hour} * * ${days}`
    }
    case 'monthly':
      return `${minute} ${hour} ${options.dayOfMonth ?? 1} * *`
    case 'custom':
      return options.custom ?? ''
    default:
      return ''
  }
}

/**
 * Parse a cron expression into options for the picker.
 */
export function parseCron(cron: string): CronOptions {
  if (!cron) {
    return { frequency: 'daily', hour: 9, minute: 0, daysOfWeek: [1] }
  }

  const parts = cron.trim().split(/\s+/)
  if (parts.length < 5) return { frequency: 'custom', custom: cron }

  const [min, hr, dom, mon, dow] = parts as [string, string, string, string, string]

  // hourly: X * * * *
  if (min !== '*' && hr === '*' && dom === '*' && mon === '*' && dow === '*') {
    return { frequency: 'hourly', minute: parseInt(min, 10) || 0 }
  }

  // daily: X Y * * *
  if (dom === '*' && mon === '*' && dow === '*') {
    return {
      frequency: 'daily',
      hour: parseInt(hr, 10) || 9,
      minute: parseInt(min, 10) || 0,
    }
  }

  // weekly: X Y * * D
  if (dom === '*' && mon === '*' && dow !== '*') {
    const days = dow.split(',').map((d) => parseInt(d, 10) || 0)
    return {
      frequency: 'weekly',
      hour: parseInt(hr, 10) || 9,
      minute: parseInt(min, 10) || 0,
      daysOfWeek: days,
    }
  }

  // monthly: X Y D * *
  if (dom !== '*' && mon === '*' && dow === '*') {
    return {
      frequency: 'monthly',
      hour: parseInt(hr, 10) || 9,
      minute: parseInt(min, 10) || 0,
      dayOfMonth: parseInt(dom, 10) || 1,
    }
  }

  return { frequency: 'custom', custom: cron }
}

/**
 * Calculate the next occurrence timestamp (in ms) from a cron expression.
 */
export function getNextOccurrence(cron: string, _timezone?: string): number | null {
  if (!cron) return null
  try {
    const opts = parseCron(cron)
    const now = new Date()
    const currentDay = now.getDay()

    switch (opts.frequency) {
      case 'hourly': {
        const next = new Date(now)
        next.setMinutes(opts.minute ?? 0, 0, 0)
        if (next.getTime() <= now.getTime()) {
          next.setHours(next.getHours() + 1)
        }
        return next.getTime()
      }
      case 'daily': {
        const next = new Date(now)
        next.setHours(opts.hour ?? 9, opts.minute ?? 0, 0, 0)
        if (next.getTime() <= now.getTime()) {
          next.setDate(next.getDate() + 1)
        }
        return next.getTime()
      }
      case 'weekly': {
        const days = opts.daysOfWeek ?? [1]
        const next = new Date(now)
        next.setHours(opts.hour ?? 9, opts.minute ?? 0, 0, 0)
        // Find next day
        for (let i = 0; i < 7; i++) {
          const checkDay = (currentDay + i) % 7
          if (days.includes(checkDay)) {
            if (i === 0) {
              // Today - check if time has passed
              if (next.getTime() <= now.getTime()) {
                continue
              }
            }
            next.setDate(next.getDate() + (i === 0 ? 0 : i))
            return next.getTime()
          }
        }
        return null
      }
      case 'monthly': {
        const dom = opts.dayOfMonth ?? 1
        const next = new Date(now)
        next.setHours(opts.hour ?? 9, opts.minute ?? 0, 0, 0)
        if (next.getDate() < dom) {
          next.setDate(dom)
        } else if (next.getDate() > dom || next.getTime() <= now.getTime()) {
          next.setMonth(next.getMonth() + 1)
          next.setDate(dom)
        }
        return next.getTime()
      }
      default:
        return null
    }
  } catch {
    return null
  }
}

/**
 * Format timestamp to relative time string.
 */
export function formatRelativeTime(timestamp: number): string {
  const diff = timestamp - Date.now()
  if (diff < 0) return 'past'

  const hours = Math.floor(diff / (1000 * 60 * 60))
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))

  if (hours >= 24) {
    const days = Math.floor(hours / 24)
    return `${days}d ${hours % 24}h`
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }
  return `${minutes}m`
}

/**
 * Format timestamp to absolute time string.
 */
export function formatAbsoluteTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

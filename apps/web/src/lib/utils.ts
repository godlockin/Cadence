import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Format a unix ms timestamp as a localized date+time string. */
export function formatTs(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(d)
}

/** Format a duration in milliseconds as a short human string. */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function cnUniq<T>(...values: T[]): T[] {
  return [...new Set(values.filter((v): v is T => v !== null && v !== undefined))]
}

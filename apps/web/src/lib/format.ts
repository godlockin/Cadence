/**
 * Centralized formatting utilities.
 * All time/cron/value formatting lives here — single source of truth.
 */

/** Mask a secret value: show first 4 + **** + last 4. */
export function maskSecret(value: string): string {
  if (value.length <= 8) return '****'
  return `${value.slice(0, 4)}****${value.slice(-4)}`
}

/**
 * Format a Unix timestamp (ms) as a localized absolute date-time string.
 * e.g. "2024-01-15 09:30:00"
 */
export function formatAbsoluteDateTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(ts))
}

/**
 * Format a Unix timestamp (ms) as a compact localized date-time string.
 * e.g. "Jan 15, 09:30"
 */
export function formatAbsoluteTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(ts))
}

/**
 * Format a Unix timestamp (ms) as a human-readable relative time.
 * e.g. "3 minutes ago", "2 hours ago"
 */
export function formatRelativeTime(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—'
  const diff = Date.now() - ts
  const abs = Math.abs(diff)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

  if (abs < 60_000) return rtf.format(-Math.floor(diff / 60_000), 'second')
  if (abs < 3_600_000) return rtf.format(-Math.floor(diff / 3_600_000), 'minute')
  if (abs < 86_400_000) return rtf.format(-Math.floor(diff / 86_400_000), 'hour')
  return rtf.format(-Math.floor(diff / 86_400_000), 'day')
}

/**
 * Format a Unix timestamp (ms) for display — relative + absolute on hover.
 * Returns { relative, absolute } for use with <span title={absolute}>.
 */
export function formatDateTime(ts: number | null | undefined): {
  relative: string
  absolute: string
} {
  return {
    relative: formatRelativeTime(ts),
    absolute: formatAbsoluteDateTime(ts),
  }
}

/**
 * Format milliseconds as a human-readable duration.
 * e.g. "1m 30s", "2h 3m 15s"
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || ms < 0) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const sec = s % 60
  if (m < 60) return sec > 0 ? `${m}m ${sec}s` : `${m}m`
  const h = Math.floor(m / 60)
  const min = m % 60
  return min > 0 ? `${h}h ${min}m` : `${h}h`
}

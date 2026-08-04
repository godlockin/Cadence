import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function LogLine({
  ts,
  line,
  level = 'info',
}: {
  ts?: number
  line: string
  level?: 'info' | 'error' | 'warn' | 'success'
}): ReactNode {
  const time = ts !== undefined ? new Date(ts).toLocaleTimeString() : null
  return (
    <div
      className={cn(
        'flex items-baseline gap-2 px-3 py-0.5 font-mono text-xs leading-6',
        level === 'error' && 'text-red-400',
        level === 'success' && 'text-emerald-400',
        level === 'warn' && 'text-amber-400',
        level === 'info' && 'text-muted-foreground',
      )}
    >
      {time !== null && <span className="shrink-0 text-muted-foreground/60">{time}</span>}
      <span className="break-all whitespace-pre-wrap">{line}</span>
    </div>
  )
}

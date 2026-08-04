import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: number
  icon?: ReactNode
  variant?: 'default' | 'danger' | 'accent'
}

export function StatCard({ title, value, icon, variant = 'default' }: StatCardProps): ReactNode {
  return (
    <div className="rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{title}</p>
        {icon !== undefined && (
          <span
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-lg',
              variant === 'danger' && 'bg-red-500/10 text-red-600 dark:text-red-400',
              variant === 'accent' && 'bg-accent/10 text-accent',
              variant === 'default' && 'bg-muted text-muted-foreground',
            )}
          >
            {icon}
          </span>
        )}
      </div>
      <p
        className={cn(
          'mt-2 text-2xl font-semibold tabular-nums',
          variant === 'danger' && 'text-destructive',
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  )
}

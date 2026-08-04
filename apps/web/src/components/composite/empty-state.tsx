import type { ReactNode } from 'react'
import { Inbox } from 'lucide-react'

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  )
}

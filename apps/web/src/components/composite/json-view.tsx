import type { ReactNode } from 'react'

function stringify(value: unknown): string {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return JSON.stringify(value, null, 2)
}

/** Pretty-printed JSON block. */
export function JsonView({ value, label }: { value: unknown; label?: string }): ReactNode {
  const text = stringify(value)
  return (
    <div className="rounded-lg border border-border bg-muted/40 p-3">
      {label !== undefined && (
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
      )}
      <pre className="overflow-auto text-xs leading-relaxed">{text}</pre>
    </div>
  )
}

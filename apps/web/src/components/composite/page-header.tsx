import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  /** Primary way to pass action buttons (new pattern) */
  actions?: ReactNode
  /** Legacy: pass action buttons as children (backward compatible) */
  children?: ReactNode
}

/**
 * Page header with title, optional description, and optional action buttons.
 *
 * Two usage patterns:
 *   <PageHeader title="Foo" description="..." actions={<Button>New</Button>} />
 *   <PageHeader title="Foo" description="..."><Button>New</Button></PageHeader>
 */
export function PageHeader({
  title,
  description,
  actions,
  children,
}: PageHeaderProps): React.ReactNode {
  const actionButtons = actions ?? children
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actionButtons !== undefined && (
        <div className="flex items-center gap-2">{actionButtons}</div>
      )}
    </div>
  )
}

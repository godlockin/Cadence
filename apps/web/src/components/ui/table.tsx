import * as React from 'react'
import { cn } from '@/lib/utils'

export function Table({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableElement>): React.ReactNode {
  return (
    <div className="relative w-full overflow-auto">
      <table className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  )
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>): React.ReactNode {
  return <thead className={cn('[&_tr]:border-b', className)} {...props} />
}

export function TableBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>): React.ReactNode {
  return <tbody className={cn('[&_tr:last-child]:border-0', className)} {...props} />
}

export function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>): React.ReactNode {
  return (
    <tfoot
      className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)}
      {...props}
    />
  )
}

export function TableRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>): React.ReactNode {
  return (
    <tr
      className={cn('border-b border-border transition-colors hover:bg-muted/50', className)}
      {...props}
    />
  )
}

export function TableHead({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>): React.ReactNode {
  return (
    <th
      className={cn(
        'h-10 px-3 text-left align-middle font-medium text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>): React.ReactNode {
  return <td className={cn('p-3 align-middle', className)} {...props} />
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>): React.ReactNode {
  return <caption className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
}

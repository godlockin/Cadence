import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/composite/page-header'
import { EmptyState } from '@/components/composite/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAuditLogs } from '@/features/admin/hooks'
import { formatTs } from '@/lib/utils'

export const Route = createFileRoute('/admin/audit')({ component: AdminAuditPage })

function AdminAuditPage(): React.ReactNode {
  const { t } = useTranslation()
  const { logs, isPending } = useAuditLogs()

  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.auditTitle')} description={`${logs.length} entries`} />
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('common.empty')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('admin.createdAt')}</TableHead>
                <TableHead>{t('admin.action')}</TableHead>
                <TableHead>{t('admin.actor')}</TableHead>
                <TableHead>{t('admin.resource')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {formatTs(log.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{log.action}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {log.actorId?.slice(0, 8) ?? 'system'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <span className="mr-1 rounded bg-muted px-1.5 py-0.5">{log.resourceKind}</span>
                    {log.resourceId.slice(0, 12)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

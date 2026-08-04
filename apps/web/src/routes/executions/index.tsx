import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { EmptyState } from '@/components/composite/empty-state'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { useExecutions } from '@/features/executions/hooks'
import { formatTs, formatDuration } from '@/lib/utils'

export const Route = createFileRoute('/executions/')({ component: ExecutionsPage })

function ExecutionsPage(): React.ReactNode {
  const { t } = useTranslation()
  const [status, setStatus] = useState('all')
  const { executions, isPending } = useExecutions({ limit: 200 }, 5000)

  const filtered = useMemo(() => {
    if (status === 'all') return executions
    return executions.filter((e) => e.status === status)
  }, [executions, status])

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('executions.title')}
        description={`${executions.length} ${t('dashboard.recent')}`}
      >
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 text-xs">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            {['pending', 'queued', 'running', 'success', 'failed', 'cancelled'].map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </PageHeader>
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('common.empty')} description={t('executions.title')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.id')}</TableHead>
                <TableHead>{t('executions.triggerSource')}</TableHead>
                <TableHead>{t('executions.startedAt')}</TableHead>
                <TableHead>{t('executions.duration')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link
                      to="/executions/$id"
                      params={{ id: e.id }}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {e.id.slice(0, 16)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.triggerSource}</TableCell>
                  <TableCell className="text-muted-foreground">{formatTs(e.startedAt)}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDuration(e.durationMs)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={e.status} />
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

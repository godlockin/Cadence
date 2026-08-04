import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarClock } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useTask } from '@/features/tasks/hooks'
import { formatTs } from '@/lib/utils'

export const Route = createFileRoute('/schedules/$id')({ component: ScheduleDetailPage })

function ScheduleDetailPage(): React.ReactNode {
  const { id } = Route.useParams()
  const { t } = useTranslation()
  const { task, isPending } = useTask(id)

  return (
    <div className="space-y-4">
      <PageHeader title={t('schedules.title')}>
        <Link
          to="/schedules"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </Link>
      </PageHeader>
      {isPending ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : task === null ? (
        <p className="text-muted-foreground">{t('common.empty')}</p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-5 w-5 text-accent" />
              {task.name}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('schedules.expression')}</span>
              <span className="font-mono">{task.cron}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.timezone')}</span>
              <span>{task.timezone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('common.status')}</span>
              <StatusBadge status={task.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.triggerKind')}</span>
              <span>{task.triggerKind}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Updated</span>
              <span>{formatTs(task.updatedAt)}</span>
            </div>
            <Link
              to="/tasks/$id"
              params={{ id: task.id }}
              className="inline-block text-sm text-accent hover:underline"
            >
              {t('tasks.detail')}
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

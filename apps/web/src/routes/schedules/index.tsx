import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { EmptyState } from '@/components/composite/empty-state'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTasks } from '@/features/tasks/hooks'

export const Route = createFileRoute('/schedules/')({ component: SchedulesPage })

function SchedulesPage(): React.ReactNode {
  const { t } = useTranslation()
  const { tasks, isPending } = useTasks({ limit: 500 })
  const schedules = tasks.filter((task) => task.cron !== null)

  return (
    <div className="space-y-4">
      <PageHeader title={t('schedules.title')} description={`${schedules.length} cron tasks`} />
      {isPending ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 rounded-xl" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <EmptyState
          title={t('common.empty')}
          description="Tasks with a cron expression appear here"
        />
      ) : (
        <div className="space-y-3">
          {schedules.map((task) => (
            <Link key={task.id} to="/tasks/$id" params={{ id: task.id }}>
              <Card className="transition-colors hover:bg-muted/40">
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent/10 text-accent">
                      <CalendarClock className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="font-medium">{task.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">{task.cron}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{task.timezone}</Badge>
                    <StatusBadge status={task.status} />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

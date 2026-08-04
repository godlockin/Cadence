/**
 * Dashboard - Simplified UX with New Task CTA and recent executions timeline.
 */
import { createFileRoute, Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Activity, CalendarClock, CheckCircle2, ListChecks, XCircle } from 'lucide-react'
import { StatCard } from '@/components/composite/stat-card'
import { StatusBadge } from '@/components/composite/status-badge'
import { PageHeader } from '@/components/composite/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/composite/empty-state'
import { useDashboardStats, useHealth } from '@/features/dashboard/hooks'
import { useExecutions } from '@/features/executions/hooks'
import { useTasks } from '@/features/tasks/hooks'
import { formatRelativeTime, formatAbsoluteTime } from '@/lib/format'
import { getNextOccurrence } from '@/lib/cron'

export const Route = createFileRoute('/dashboard')({ component: DashboardPage })

function DashboardPage(): React.ReactNode {
  const { t } = useTranslation()
  const { stats } = useDashboardStats()
  const { executions, isPending: execPending } = useExecutions({ limit: 5 }, 5000)
  const { tasks: allTasks } = useTasks({ status: 'active' }, 30000)

  // Get pending tasks (next 10)
  const pendingTasks = allTasks
    .filter((task) => task.status === 'pending' || task.status === 'scheduled')
    .slice(0, 5)

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('dashboard.title')}
        description={t('app.tagline')}
        actions={
          <Link to="/tasks/new">
            <Button>
              <ListChecks className="h-4 w-4 mr-2" />
              {t('dashboard.newTask')}
            </Button>
          </Link>
        }
      />

      {/* Quick stats row */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          title={t('dashboard.activeTasks')}
          value={stats.activeTasks}
          icon={<ListChecks className="h-4 w-4" />}
        />
        <StatCard
          title={t('dashboard.schedules')}
          value={stats.schedules}
          icon={<CalendarClock className="h-4 w-4" />}
        />
        <StatCard
          title={t('dashboard.executionsToday')}
          value={stats.executionsToday}
          icon={<Activity className="h-4 w-4" />}
        />
        <StatCard
          title={t('dashboard.failures')}
          value={stats.failures}
          icon={<XCircle className="h-4 w-4" />}
          variant="danger"
        />
      </div>

      {/* Recent 5 executions timeline */}
      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.recent5executions')}</CardTitle>
        </CardHeader>
        <CardContent>
          {execPending ? (
            <div className="space-y-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : executions.length === 0 ? (
            <EmptyState
              title={t('common.empty')}
              description={t('executions.title')}
              action={
                <Link to="/tasks/new">
                  <Button size="sm">{t('dashboard.newTask')}</Button>
                </Link>
              }
            />
          ) : (
            <div className="relative space-y-0">
              {/* Timeline line */}
              <div className="absolute left-[15px] top-6 bottom-6 w-px bg-border" />
              <div className="space-y-3">
                {executions.map((e) => (
                  <Link
                    key={e.id}
                    to="/executions/$id"
                    params={{ id: e.id }}
                    className="flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-muted"
                  >
                    {/* Timeline dot */}
                    <div
                      className={`relative z-10 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full ${
                        e.status === 'success'
                          ? 'bg-emerald-500/20 text-emerald-600'
                          : e.status === 'failed'
                            ? 'bg-red-500/20 text-red-600'
                            : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {e.status === 'success' ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : e.status === 'failed' ? (
                        <XCircle className="h-4 w-4" />
                      ) : (
                        <Activity className="h-4 w-4" />
                      )}
                    </div>
                    {/* Content */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground">
                          {e.id.slice(0, 8)}
                        </span>
                        <StatusBadge status={e.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {e.startedAt !== null ? formatAbsoluteTime(e.startedAt) : '-'}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pending tasks */}
      {pendingTasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.pendingTasks')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingTasks.map((task) => {
                const nextTs = task.cron !== null ? getNextOccurrence(task.cron) : null
                return (
                  <Link
                    key={task.id}
                    to="/tasks/$id"
                    params={{ id: task.id }}
                    className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-muted"
                  >
                    <div className="flex items-center gap-3">
                      <CalendarClock className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm">{task.name}</span>
                    </div>
                    {nextTs !== null && (
                      <span className="text-xs text-muted-foreground">
                        {t('dashboard.nextTrigger')}: {formatRelativeTime(nextTs)}
                      </span>
                    )}
                  </Link>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      <SystemStatus />
    </div>
  )
}

function SystemStatus(): React.ReactNode {
  const { t } = useTranslation()
  const { health, isPending } = useHealth()
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('dashboard.systemStatus')}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm sm:grid-cols-2">
        {isPending || health === null ? (
          <>
            <Skeleton className="h-5" />
            <Skeleton className="h-5" />
          </>
        ) : (
          <>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">{t('dashboard.health')}</span>
              <span className="font-medium">
                {health.status === 'ok' ? t('dashboard.ok') : health.status}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">{t('dashboard.database')}</span>
              <span className="font-medium">
                {health.db ? t('dashboard.ok') : t('dashboard.err')}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">{t('dashboard.scheduler')}</span>
              <span className="font-medium">
                {health.scheduler.running ? t('dashboard.running') : t('dashboard.stopped')}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
              <span className="text-muted-foreground">{t('dashboard.version')}</span>
              <span className="font-mono text-xs">{health.version}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

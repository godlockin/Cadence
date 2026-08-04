import { useState } from 'react'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CalendarClock, Pencil, RotateCcw, Pause, Zap } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { JsonView } from '@/components/composite/json-view'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  useCancelExecutions,
  useDeleteTask,
  useResumeTask,
  useSuspendTask,
  useTask,
  useTriggerTask,
} from '@/features/tasks/hooks'
import { useExecutions } from '@/features/executions/hooks'
import { errorMessage } from '@/lib/api'
import { formatTs } from '@/lib/utils'
import { formatAbsoluteTime, formatRelativeTime } from '@/lib/format'
import { getNextOccurrence } from '@/lib/cron'

export const Route = createFileRoute('/tasks/$id/_index')({ component: TaskDetailPage })

function TaskDetailPage(): React.ReactNode {
  const { id } = Route.useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { task, isPending, error } = useTask(id)
  const { executions } = useExecutions({ taskId: id, limit: 10 }, 5000)

  const trigger = useTriggerTask()
  const suspend = useSuspendTask()
  const resume = useResumeTask()
  const cancel = useCancelExecutions()
  const deleteTask = useDeleteTask()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (error !== null || task === null) {
    return (
      <div className="space-y-4">
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('tasks.title')}
        </Link>
        <p className="text-destructive">{errorMessage(error)}</p>
      </div>
    )
  }

  const handleTrigger = (): void => {
    setErrorMsg('')
    trigger.mutate(task.id, {
      onError: (e) => setErrorMsg(errorMessage(e)),
      onSuccess: () => void navigate({ to: '/executions', replace: true }),
    })
  }
  const handleSuspend = (): void => {
    suspend.mutate(task.id, { onError: (e) => setErrorMsg(errorMessage(e)) })
  }
  const handleResume = (): void => {
    resume.mutate(task.id, { onError: (e) => setErrorMsg(errorMessage(e)) })
  }
  const handleCancel = (): void => {
    cancel.mutate(task.id, { onError: (e) => setErrorMsg(errorMessage(e)) })
  }
  const handleDelete = (): void => {
    deleteTask.mutate(task.id, {
      onError: (e) => setErrorMsg(errorMessage(e)),
      onSuccess: () => void navigate({ to: '/tasks', replace: true }),
    })
    setConfirmOpen(false)
  }

  const isSuspended = task.status === 'suspended'
  const isActive = ['pending', 'scheduled', 'queued', 'dispatched', 'running'].includes(task.status)

  return (
    <div className="space-y-6">
      <PageHeader title={task.name} description={task.description}>
        {/* Next occurrence preview */}
        {task.cron && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CalendarClock className="h-4 w-4" />
            <span>{t('cron.nextRun')}:</span>
            {(() => {
              const nextTs = getNextOccurrence(task.cron)
              return nextTs ? (
                <span className="font-medium">
                  {formatAbsoluteTime(nextTs)} ({formatRelativeTime(nextTs)})
                </span>
              ) : (
                <span>—</span>
              )
            })()}
          </div>
        )}
        <Link
          to="/tasks/$id/edit"
          params={{ id: task.id }}
          className="inline-flex items-center gap-1"
        >
          <Button variant="outline" size="sm">
            <Pencil className="h-4 w-4" /> {t('common.edit')}
          </Button>
        </Link>
        {/* Test now button - prominent */}
        <Button
          size="sm"
          variant="default"
          className="bg-blue-600 hover:bg-blue-700"
          onClick={handleTrigger}
          disabled={trigger.isPending}
        >
          <Zap className="h-4 w-4 mr-1" />
          {trigger.isPending ? t('wizard.testRunning') : t('wizard.testTask')}
        </Button>
        {isSuspended ? (
          <Button variant="secondary" size="sm" onClick={handleResume} disabled={resume.isPending}>
            <RotateCcw className="h-4 w-4" /> {t('tasks.resume')}
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSuspend}
            disabled={suspend.isPending || !isActive}
          >
            <Pause className="h-4 w-4" /> {t('tasks.suspend')}
          </Button>
        )}
      </PageHeader>

      {errorMsg !== '' && <p className="text-sm text-destructive">{errorMsg}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>{t('tasks.detail')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('common.status')}</span>
              <StatusBadge status={task.status} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.payloadKind')}</span>
              <Badge variant="outline">{task.payloadKind}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.triggerKind')}</span>
              <Badge variant="outline">{task.triggerKind}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.cron')}</span>
              <span className="font-mono text-xs">{task.cron ?? '—'}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.timezone')}</span>
              <span>{task.timezone}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.maxRetries')}</span>
              <span>{task.maxRetries}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t('tasks.concurrency')}</span>
              <span>{task.concurrencyPolicy}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Version</span>
              <span className="font-mono text-xs">{task.version}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Updated</span>
              <span className="text-xs">{formatTs(task.updatedAt)}</span>
            </div>
            {task.tags.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {task.tags.map((tg) => (
                  <Badge key={tg} variant="secondary">
                    {tg}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>{t('tasks.payload')}</CardTitle>
            </CardHeader>
            <CardContent>
              <JsonView value={task.payload} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('executions.title')}</CardTitle>
              <Button variant="ghost" size="sm" onClick={handleCancel} disabled={cancel.isPending}>
                {t('tasks.cancel')}
              </Button>
            </CardHeader>
            <CardContent>
              {executions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
              ) : (
                <div className="space-y-1">
                  {executions.map((e) => (
                    <Link
                      key={e.id}
                      to="/executions/$id"
                      params={{ id: e.id }}
                      className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-muted"
                    >
                      <span className="font-mono text-xs text-muted-foreground">
                        {e.id.slice(0, 12)}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatTs(e.startedAt)}</span>
                      <StatusBadge status={e.status} />
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('common.delete')}</DialogTitle>
            <DialogDescription>{task.name}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleteTask.isPending}>
              {t('common.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

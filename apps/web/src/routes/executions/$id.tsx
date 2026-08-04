import { useEffect, useRef } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Activity } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { SSEStatusIndicator } from '@/components/composite/sse-status-indicator'
import { JsonView } from '@/components/composite/json-view'
import { LogLine } from '@/components/composite/log-line'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { useExecution } from '@/features/executions/hooks'
import { useSSE } from '@/hooks/useSSE'
import { formatTs, formatDuration } from '@/lib/utils'

export const Route = createFileRoute('/executions/$id')({ component: ExecutionDetailPage })

function ExecutionDetailPage(): React.ReactNode {
  const { id } = Route.useParams()
  const { t } = useTranslation()
  const { execution, isPending, error } = useExecution(id)
  const { events: sseEvents, connectionStatus } = useSSE(
    execution?.status === 'running' || execution?.status === 'queued' ? id : null,
  )

  const logRef = useRef<HTMLDivElement | null>(null)
  const userScrolledUpRef = useRef(false)
  useEffect(() => {
    if (!userScrolledUpRef.current) {
      logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
    }
  }, [sseEvents])

  const handleScroll = (): void => {
    const el = logRef.current
    if (el === null) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    userScrolledUpRef.current = !atBottom
  }

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (error !== null || execution === null) {
    return (
      <div className="space-y-4">
        <Link
          to="/executions"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('executions.title')}
        </Link>
        <p className="text-destructive">{error?.message}</p>
      </div>
    )
  }

  const logLines = sseEvents.filter(
    (e): e is Extract<typeof e, { type: 'log' }> => e.type === 'log',
  )
  const statusEvents = sseEvents.filter(
    (e): e is Extract<typeof e, { type: 'status' }> => e.type === 'status',
  )
  const lastStatus =
    statusEvents.length > 0 ? (statusEvents[statusEvents.length - 1] ?? null) : null
  const streamOpen = execution.status === 'running' || execution.status === 'queued'

  return (
    <div className="space-y-4">
      <PageHeader title={t('executions.detail')} description={execution.id}>
        <div className="flex items-center gap-3">
          {streamOpen && <SSEStatusIndicator status={connectionStatus} />}
          <Link
            to="/executions"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> {t('common.back')}
          </Link>
        </div>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <StatusBadge status={execution.status} />
            {streamOpen && <Activity className="h-4 w-4 animate-pulse text-accent" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('executions.triggerSource')}</p>
            <p className="font-medium">{execution.triggerSource}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('executions.startedAt')}</p>
            <p className="font-medium">{formatTs(execution.startedAt)}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('executions.duration')}</p>
            <p className="font-medium">{formatDuration(execution.durationMs)}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('executions.retryCount')}</p>
            <p className="font-medium">{execution.retryCount}</p>
          </div>
          <div className="rounded-lg border border-border px-3 py-2">
            <p className="text-xs text-muted-foreground">{t('tasks.title')}</p>
            <Link
              to="/tasks/$id"
              params={{ id: execution.taskId }}
              className="font-medium text-accent hover:underline"
            >
              {execution.taskId.slice(0, 12)}
            </Link>
          </div>
          {execution.finishedAt !== null && (
            <div className="rounded-lg border border-border px-3 py-2">
              <p className="text-xs text-muted-foreground">{t('executions.finishedAt')}</p>
              <p className="font-medium">{formatTs(execution.finishedAt)}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>{t('executions.liveLog')}</CardTitle>
          <div className="flex items-center gap-2">
            {streamOpen ? (
              <Badge variant="accent">{t('executions.streaming')}</Badge>
            ) : (
              <Badge variant="secondary">{t('executions.streamClosed')}</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div
            ref={logRef}
            onScroll={handleScroll}
            className="max-h-96 overflow-y-auto rounded-lg border border-border bg-muted/40 p-2"
          >
            {logLines.length === 0 && sseEvents.length === 0 ? (
              <LogLine line={t('executions.awaitingData')} />
            ) : (
              <>
                {logLines.map((line, i) => (
                  <LogLine
                    key={i}
                    ts={line.ts}
                    line={line.line}
                    level={line.line.toLowerCase().includes('error') ? 'error' : 'info'}
                  />
                ))}
                {lastStatus !== null && (
                  <LogLine
                    level="success"
                    ts={lastStatus.ts}
                    line={`→ status: ${lastStatus.status}`}
                  />
                )}
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {(execution.error !== null || execution.result !== null) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {execution.error !== null && (
            <JsonView value={execution.error} label={t('executions.error')} />
          )}
          {execution.result !== null && (
            <JsonView value={execution.result} label={t('executions.result')} />
          )}
        </div>
      )}
    </div>
  )
}

import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { TaskForm } from '@/features/tasks/task-form'
import { useTask, useUpdateTask, useTriggerTask } from '@/features/tasks/hooks'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/tasks/$id/edit')({ component: TaskEditPage })

function TaskEditPage(): React.ReactNode {
  const { id } = Route.useParams()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { task, isPending, error } = useTask(id)
  const updateTask = useUpdateTask()
  const trigger = useTriggerTask()
  const [errorMsg, setErrorMsg] = useState('')

  if (isPending) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-96" />
      </div>
    )
  }
  if (error !== null || task === null) {
    return <p className="text-destructive">{errorMessage(error)}</p>
  }

  const handleSave = async (body: Record<string, unknown>): Promise<void> => {
    setErrorMsg('')
    try {
      await updateTask.mutateAsync({ id, patch: body })
      void navigate({ to: '/tasks/$id', params: { id }, replace: true })
    } catch (e: unknown) {
      setErrorMsg(errorMessage(e))
    }
  }

  const handleTest = (): void => {
    setErrorMsg('')
    trigger.mutate(task.id, {
      onError: (e) => setErrorMsg(errorMessage(e)),
    })
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('tasks.editTask')} description={task.name}>
        <Link
          to="/tasks/$id"
          params={{ id }}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </Link>
      </PageHeader>
      {errorMsg !== '' && <p className="text-sm text-destructive">{errorMsg}</p>}
      <TaskForm
        initial={task}
        isEdit
        onSubmit={handleSave}
        onTest={handleTest}
        submitting={updateTask.isPending}
      />
    </div>
  )
}

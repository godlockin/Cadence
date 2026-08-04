import { useMemo, useState } from 'react'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { StatusBadge } from '@/components/composite/status-badge'
import { EmptyState } from '@/components/composite/empty-state'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
import { useTasks } from '@/features/tasks/hooks'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/tasks/')({ component: TasksPage })

function TasksPage(): React.ReactNode {
  const { t } = useTranslation()
  const { tasks, isPending } = useTasks({ limit: 500 })
  const [q, setQ] = useState('')
  const [tag, setTag] = useState('all')
  const [status, setStatus] = useState('all')

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const task of tasks) {
      for (const tg of task.tags) set.add(tg)
    }
    return [...set].sort()
  }, [tasks])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return tasks.filter((task) => {
      if (status !== 'all' && task.status !== status) return false
      if (tag !== 'all' && !task.tags.includes(tag)) return false
      if (needle.length === 0) return true
      return (
        task.name.toLowerCase().includes(needle) ||
        task.id.toLowerCase().includes(needle) ||
        (task.description ?? '').toLowerCase().includes(needle)
      )
    })
  }, [tasks, q, tag, status])

  return (
    <div className="space-y-4">
      <PageHeader title={t('tasks.title')} description={`${tasks.length} ${t('common.total')}`}>
        <Link to="/tasks/new">
          <Button size="sm">
            <Plus className="h-4 w-4" />
            {t('tasks.newTask')}
          </Button>
        </Link>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('common.search')}
            className="w-64 pl-8"
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-36 text-xs">
            <SelectValue placeholder={t('common.status')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common.all')}</SelectItem>
            {[
              'pending',
              'scheduled',
              'queued',
              'running',
              'success',
              'failed',
              'cancelled',
              'suspended',
            ].map((s) => (
              <SelectItem key={s} value={s}>
                {t(`status.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={tag} onValueChange={setTag}>
          <SelectTrigger className="w-36 text-xs">
            <SelectValue placeholder={t('tasks.tagFilter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('tasks.allTags')}</SelectItem>
            {allTags.map((tg) => (
              <SelectItem key={tg} value={tg}>
                {tg}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-xl border border-border bg-card shadow-sm">
        {isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('tasks.noTasks')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('common.name')}</TableHead>
                <TableHead>{t('tasks.payloadKind')}</TableHead>
                <TableHead>{t('tasks.triggerKind')}</TableHead>
                <TableHead>{t('common.status')}</TableHead>
                <TableHead>{t('tasks.tags')}</TableHead>
                <TableHead className="text-right">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((task) => (
                <TableRow key={task.id}>
                  <TableCell>
                    <Link
                      to="/tasks/$id"
                      params={{ id: task.id }}
                      className="font-medium hover:text-accent"
                    >
                      {task.name}
                    </Link>
                    <p className="font-mono text-xs text-muted-foreground">
                      {task.id.slice(0, 12)}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{task.payloadKind}</Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{task.triggerKind}</TableCell>
                  <TableCell>
                    <StatusBadge status={task.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-[200px] flex-wrap gap-1">
                      {task.tags.map((tg) => (
                        <Badge key={tg} variant="secondary" className={cn('text-xs')}>
                          {tg}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to="/tasks/$id/edit"
                      params={{ id: task.id }}
                      className="text-sm text-accent hover:underline"
                    >
                      {t('common.edit')}
                    </Link>
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

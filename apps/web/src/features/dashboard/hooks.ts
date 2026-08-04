import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import { useExecutions } from '@/features/executions/hooks'
import { useTasks } from '@/features/tasks/hooks'
import type { HealthStatus } from '@/lib/types'

const activeStatuses = new Set(['pending', 'scheduled', 'queued', 'dispatched', 'running'])

export interface DashboardStats {
  activeTasks: number
  schedules: number
  executionsToday: number
  failures: number
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function useDashboardStats(): {
  stats: DashboardStats
  isPending: boolean
} {
  const accessToken = useAuthStore((s) => s.accessToken)
  const { tasks, isPending: tasksPending } = useTasks({ limit: 500 })
  const { executions, isPending: execPending } = useExecutions({ limit: 500 })

  const stats: DashboardStats = {
    activeTasks: tasks.filter((t) => activeStatuses.has(t.status)).length,
    schedules: tasks.filter((t) => t.cron !== null).length,
    executionsToday: executions.filter((e) => e.startedAt !== null && e.startedAt >= startOfToday())
      .length,
    failures: executions.filter((e) => e.status === 'failed').length,
  }
  void accessToken
  return { stats, isPending: tasksPending || execPending }
}

export function useHealth(): {
  health: HealthStatus | null
  isPending: boolean
  isError: boolean
} {
  const result = useQuery<HealthStatus>({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthStatus>('/health'),
  })
  return {
    health: result.data ?? null,
    isPending: result.isPending,
    isError: result.isError,
  }
}

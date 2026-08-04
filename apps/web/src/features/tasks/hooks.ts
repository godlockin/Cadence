import { useMutation, useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Task } from '@/lib/types'

export interface TaskListQuery {
  status?: string
  payloadKind?: string
  tag?: string
  q?: string
  limit?: number
  offset?: number
}

export function useTasks(
  query: TaskListQuery = {},
  refetchInterval?: number,
): {
  tasks: Task[]
  isPending: boolean
  isError: boolean
  error: Error | null
} {
  const params = new URLSearchParams()
  if (query.status !== undefined) params.set('status', query.status)
  if (query.payloadKind !== undefined) params.set('payloadKind', query.payloadKind)
  if (query.tag !== undefined) params.set('tag', query.tag)
  if (query.q !== undefined) params.set('q', query.q)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const qs = params.toString()
  const result = useQuery<Task[]>({
    queryKey: ['tasks', qs],
    queryFn: async () => {
      const data = await apiFetch<{ tasks: Task[] }>(`/tasks${qs.length > 0 ? `?${qs}` : ''}`)
      return data.tasks
    },
    refetchInterval,
    placeholderData: (prev) => prev,
  })
  return {
    tasks: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
    error: result.error ?? null,
  }
}

export function useTask(
  id: string | undefined,
  options?: Omit<UseQueryOptions<Task, Error>, 'queryKey' | 'queryFn'>,
): { task: Task | null; isPending: boolean; isError: boolean; error: Error | null } {
  const result = useQuery<Task, Error>({
    queryKey: ['task', id],
    queryFn: async () => {
      const data = await apiFetch<{ task: Task }>(`/tasks/${id as string}`)
      return data.task
    },
    enabled: id !== undefined,
    ...options,
  })
  return {
    task: result.data ?? null,
    isPending: result.isPending,
    isError: result.isError,
    error: result.error ?? null,
  }
}

export function useCreateTask(): ReturnType<
  typeof useMutation<Task, Error, Record<string, unknown>>
> {
  const qc = useQueryClient()
  return useMutation<Task, Error, Record<string, unknown>>({
    mutationFn: async (body) => {
      const data = await apiFetch<{ task: Task }>('/tasks', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return data.task
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useUpdateTask(): ReturnType<
  typeof useMutation<Task, Error, { id: string; patch: Record<string, unknown> }>
> {
  const qc = useQueryClient()
  return useMutation<Task, Error, { id: string; patch: Record<string, unknown> }>({
    mutationFn: async ({ id, patch }) => {
      const data = await apiFetch<{ task: Task }>(`/tasks/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return data.task
    },
    onSuccess: (task) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
    },
  })
}

export function useDeleteTask(): ReturnType<typeof useMutation<{ ok: boolean }, Error, string>> {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (id) => apiFetch<{ ok: boolean }>(`/tasks/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })
}

export function useTriggerTask(): ReturnType<
  typeof useMutation<{ executionId: string }, Error, string>
> {
  const qc = useQueryClient()
  return useMutation<{ executionId: string }, Error, string>({
    mutationFn: async (id) =>
      apiFetch<{ executionId: string }>(`/tasks/${id}/trigger`, { method: 'POST', body: '{}' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['executions'] })
    },
  })
}

export function useSuspendTask(): ReturnType<typeof useMutation<Task, Error, string>> {
  const qc = useQueryClient()
  return useMutation<Task, Error, string>({
    mutationFn: async (id) => {
      const data = await apiFetch<{ task: Task }>(`/tasks/${id}/suspend`, { method: 'POST' })
      return data.task
    },
    onSuccess: (task) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
    },
  })
}

export function useResumeTask(): ReturnType<typeof useMutation<Task, Error, string>> {
  const qc = useQueryClient()
  return useMutation<Task, Error, string>({
    mutationFn: async (id) => {
      const data = await apiFetch<{ task: Task }>(`/tasks/${id}/resume`, { method: 'POST' })
      return data.task
    },
    onSuccess: (task) => {
      void qc.invalidateQueries({ queryKey: ['tasks'] })
      void qc.invalidateQueries({ queryKey: ['task', task.id] })
    },
  })
}

export function useCancelExecutions(): ReturnType<
  typeof useMutation<{ cancelled: number }, Error, string>
> {
  const qc = useQueryClient()
  return useMutation<{ cancelled: number }, Error, string>({
    mutationFn: async (id) =>
      apiFetch<{ cancelled: number }>(`/tasks/${id}/cancel`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['executions'] })
    },
  })
}

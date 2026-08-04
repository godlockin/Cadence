import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Execution } from '@/lib/types'

export interface ExecutionListQuery {
  taskId?: string
  status?: string
  limit?: number
  offset?: number
}

export function useExecutions(
  query: ExecutionListQuery = {},
  refetchInterval?: number,
): {
  executions: Execution[]
  isPending: boolean
  isError: boolean
} {
  const params = new URLSearchParams()
  if (query.taskId !== undefined) params.set('taskId', query.taskId)
  if (query.status !== undefined) params.set('status', query.status)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.offset !== undefined) params.set('offset', String(query.offset))
  const qs = params.toString()
  const result = useQuery<Execution[]>({
    queryKey: ['executions', qs],
    queryFn: async () => {
      const data = await apiFetch<{ executions: Execution[] }>(
        `/executions${qs.length > 0 ? `?${qs}` : ''}`,
      )
      return data.executions
    },
    refetchInterval,
    placeholderData: (prev) => prev,
  })
  return {
    executions: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
  }
}

export function useExecution(id: string | undefined): {
  execution: Execution | null
  isPending: boolean
  isError: boolean
  error: Error | null
} {
  const result = useQuery<Execution, Error>({
    queryKey: ['execution', id],
    queryFn: async () => {
      const data = await apiFetch<{ execution: Execution }>(`/executions/${id as string}`)
      return data.execution
    },
    enabled: id !== undefined,
  })
  return {
    execution: result.data ?? null,
    isPending: result.isPending,
    isError: result.isError,
    error: result.error ?? null,
  }
}

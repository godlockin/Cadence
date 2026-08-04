import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { AuditLog, Group, PublicUser } from '@/lib/types'

export function useUsers(): { users: PublicUser[]; isPending: boolean; isError: boolean } {
  const result = useQuery<PublicUser[]>({
    queryKey: ['admin', 'users'],
    queryFn: async () => {
      const data = await apiFetch<{ users: PublicUser[] }>('/users')
      return data.users
    },
  })
  return {
    users: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
  }
}

export function useGroups(): { groups: Group[]; isPending: boolean; isError: boolean } {
  const result = useQuery<Group[]>({
    queryKey: ['admin', 'groups'],
    queryFn: async () => {
      const data = await apiFetch<{ groups: Group[] }>('/groups')
      return data.groups
    },
  })
  return {
    groups: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
  }
}

export function useAuditLogs(): {
  logs: AuditLog[]
  isPending: boolean
  isError: boolean
} {
  const result = useQuery<AuditLog[]>({
    queryKey: ['admin', 'audit'],
    queryFn: async () => {
      const data = await apiFetch<{ logs: AuditLog[] }>('/audit/logs')
      return data.logs
    },
  })
  return {
    logs: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
  }
}

export interface InviteUserInput {
  email: string
  password: string
  displayName: string
  role: string
}

export function useInviteUser(): ReturnType<
  typeof useMutation<PublicUser, Error, InviteUserInput>
> {
  const qc = useQueryClient()
  return useMutation<PublicUser, Error, InviteUserInput>({
    mutationFn: async (body) => {
      const data = await apiFetch<{ user: PublicUser }>('/users/invite', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return data.user
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useUpdateUser(): ReturnType<
  typeof useMutation<PublicUser, Error, { id: string; patch: Record<string, unknown> }>
> {
  const qc = useQueryClient()
  return useMutation<PublicUser, Error, { id: string; patch: Record<string, unknown> }>({
    mutationFn: async ({ id, patch }) => {
      const data = await apiFetch<{ user: PublicUser }>(`/users/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return data.user
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'users'] })
    },
  })
}

export function useAddGroupMember(): ReturnType<
  typeof useMutation<{ ok: boolean }, Error, { groupId: string; userId: string }>
> {
  return useMutation<{ ok: boolean }, Error, { groupId: string; userId: string }>({
    mutationFn: async ({ groupId, userId }) =>
      apiFetch<{ ok: boolean }>(`/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId }),
      }),
  })
}

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import type { Credential } from '@/lib/types'

export function useCredentials(): {
  credentials: Credential[]
  isPending: boolean
  isError: boolean
} {
  const result = useQuery<Credential[]>({
    queryKey: ['credentials'],
    queryFn: async () => {
      const data = await apiFetch<{ credentials: Credential[] }>('/credentials')
      return data.credentials
    },
  })
  return {
    credentials: result.data ?? [],
    isPending: result.isPending,
    isError: result.isError,
  }
}

export interface CreateCredentialInput {
  name: string
  kind: string
  secret: string
  type?: string
  clientId?: string
  tokenEndpoint?: string
  expiresInSeconds?: number
}

export function useCreateCredential(): ReturnType<
  typeof useMutation<Credential, Error, CreateCredentialInput>
> {
  const qc = useQueryClient()
  return useMutation<Credential, Error, CreateCredentialInput>({
    mutationFn: async (body) => {
      const data = await apiFetch<{ credential: Credential }>('/credentials', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      return data.credential
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

export function useDeleteCredential(): ReturnType<
  typeof useMutation<{ ok: boolean }, Error, string>
> {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, string>({
    mutationFn: async (id) => apiFetch<{ ok: boolean }>(`/credentials/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

export interface RefreshCredentialResult {
  ok: boolean
  refreshedAt?: number
  rotatedAt?: number
  version?: number
}

export function useRefreshCredential(): ReturnType<
  typeof useMutation<RefreshCredentialResult, Error, string>
> {
  const qc = useQueryClient()
  return useMutation<RefreshCredentialResult, Error, string>({
    mutationFn: async (id) =>
      apiFetch<RefreshCredentialResult>(`/credentials/${id}/refresh`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

export function useRotateCredential(): ReturnType<
  typeof useMutation<RefreshCredentialResult, Error, string>
> {
  const qc = useQueryClient()
  return useMutation<RefreshCredentialResult, Error, string>({
    mutationFn: async (id) =>
      apiFetch<RefreshCredentialResult>(`/credentials/${id}/rotate`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['credentials'] })
    },
  })
}

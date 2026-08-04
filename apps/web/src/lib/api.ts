import { useAuthStore } from './store'

export class ApiError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(status: number, body: unknown) {
    super(`API request failed with status ${status}`)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/** human-readable error message extracted from the API error envelope */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: unknown; error?: unknown } | null
    if (typeof body?.message === 'string') return body.message
    if (typeof body?.error === 'string') return body.error
    return `Request failed (${err.status})`
  }
  if (err instanceof Error) return err.message
  return 'Unexpected error'
}

let refreshPromise: Promise<boolean> | null = null

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = useAuthStore.getState().refreshToken
  if (refreshToken === null) return false
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    })
    if (!res.ok) return false
    const data = (await res.json()) as {
      accessToken: string
      refreshToken: string
      expiresIn: number
    }
    useAuthStore.getState().setTokens(data.accessToken, data.refreshToken)
    return true
  } catch {
    return false
  }
}

function refreshOnce(): Promise<boolean> {
  if (refreshPromise === null) {
    refreshPromise = tryRefreshToken().finally(() => {
      refreshPromise = null
    })
  }
  return refreshPromise
}

/** fetch wrapper: prepends /api, attaches Bearer token, refreshes on 401. */
export async function apiFetch<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const accessToken = useAuthStore.getState().accessToken
  const headers: Record<string, string> = {}
  const rawHeaders = opts.headers
  if (rawHeaders !== undefined) {
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(rawHeaders)) {
      for (const [key, value] of rawHeaders) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, rawHeaders)
    }
  }
  if (headers['Content-Type'] === undefined && opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (accessToken !== null) {
    headers['Authorization'] = `Bearer ${accessToken}`
  }

  const res = await fetch(`/api${path}`, { ...opts, headers })

  if (res.status === 401) {
    const refreshed = await refreshOnce()
    if (refreshed) {
      const token = useAuthStore.getState().accessToken
      const retryHeaders: Record<string, string> = { ...headers }
      if (token !== null) retryHeaders['Authorization'] = `Bearer ${token}`
      const retry = await fetch(`/api${path}`, { ...opts, headers: retryHeaders })
      if (retry.ok) {
        if (retry.status === 204) return undefined as T
        return (await retry.json()) as T
      }
      if (!retry.ok) {
        throw new ApiError(retry.status, await retry.json().catch(() => ({})))
      }
    }
    useAuthStore.getState().clear()
    throw new ApiError(401, await res.json().catch(() => ({})))
  }

  if (!res.ok) {
    throw new ApiError(res.status, await res.json().catch(() => ({})))
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

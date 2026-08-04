import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiFetch } from '@/lib/api'
import { useAuthStore } from '@/lib/store'
import type { AuthResponse, PublicUser } from '@/lib/types'

interface AuthContextValue {
  user: PublicUser | null
  isAuthenticated: boolean
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, displayName: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function hydrate(): Promise<void> {
      const token = useAuthStore.getState().accessToken
      if (token !== null && useAuthStore.getState().user === null) {
        try {
          const me = await apiFetch<PublicUser>('/auth/me')
          if (!cancelled) useAuthStore.getState().setUser(me)
        } catch {
          if (!cancelled) useAuthStore.getState().clear()
        }
      }
      if (!cancelled) setIsLoading(false)
    }
    void hydrate()
    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (email: string, password: string): Promise<void> => {
    const res = await apiFetch<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    useAuthStore.getState().setAuth(res.user, res.accessToken, res.refreshToken)
  }, [])

  const register = useCallback(
    async (email: string, password: string, displayName: string): Promise<void> => {
      const res = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      })
      useAuthStore.getState().setAuth(res.user, res.accessToken, res.refreshToken)
    },
    [],
  )

  const logout = useCallback(async (): Promise<void> => {
    const refreshToken = useAuthStore.getState().refreshToken
    if (refreshToken !== null) {
      try {
        await apiFetch('/auth/logout', {
          method: 'POST',
          body: JSON.stringify({ refreshToken }),
        })
      } catch {
        /* best-effort revoke */
      }
    }
    useAuthStore.getState().clear()
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: accessToken !== null,
      isLoading,
      login,
      register,
      logout,
    }),
    [user, accessToken, isLoading, login, register, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (ctx === null) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}

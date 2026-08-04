import { create } from 'zustand'
import type { PublicUser } from './types'

/**
 * Client-side auth state.
 *
 * Security requirement: JWT access + refresh tokens live **in memory only**.
 * They are never written to localStorage/sessionStorage, so a stored XSS
 * cannot exfiltrate a durable credential. The downside — a full page reload
 * requires re-authentication — is an accepted trade-off for v0.1.
 */
interface AuthState {
  user: PublicUser | null
  accessToken: string | null
  refreshToken: string | null
  setAuth: (user: PublicUser, accessToken: string, refreshToken: string) => void
  setTokens: (accessToken: string, refreshToken: string) => void
  setUser: (user: PublicUser) => void
  clear: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  accessToken: null,
  refreshToken: null,
  setAuth: (user, accessToken, refreshToken) => set({ user, accessToken, refreshToken }),
  setTokens: (accessToken, refreshToken) => set({ accessToken, refreshToken }),
  setUser: (user) => set({ user }),
  clear: () => set({ user: null, accessToken: null, refreshToken: null }),
}))

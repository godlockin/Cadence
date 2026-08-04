import { useEffect, type ReactNode } from 'react'
import { createRootRoute, Outlet, useLocation, useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { Sidebar } from '@/components/layout/sidebar'
import { Header } from '@/components/layout/header'
import { useAuth } from '@/hooks/useAuth'

export const Route = createRootRoute({
  component: RootLayout,
})

function FullPageLoader(): ReactNode {
  return (
    <div className="flex h-screen items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}

function Protected({ children }: { children: ReactNode }): ReactNode {
  const { isAuthenticated, isLoading } = useAuth()
  const navigate = useNavigate()
  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      void navigate({ to: '/login', replace: true })
    }
  }, [isLoading, isAuthenticated, navigate])
  if (isLoading) return <FullPageLoader />
  if (!isAuthenticated) return null
  return <>{children}</>
}

function RootLayout(): ReactNode {
  const location = useLocation()
  const isAuthPage = location.pathname === '/login' || location.pathname === '/register'
  if (isAuthPage) {
    return <Outlet />
  }
  return (
    <Protected>
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            <div className="mx-auto max-w-6xl">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </Protected>
  )
}

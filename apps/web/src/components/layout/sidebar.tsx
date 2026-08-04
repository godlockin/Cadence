import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  CalendarClock,
  Gauge,
  KeyRound,
  ListChecks,
  ShieldCheck,
  ScrollText,
  Users,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/hooks/useAuth'

const baseNav = [
  { to: '/dashboard', label: 'dashboard', icon: Gauge },
  { to: '/tasks', label: 'tasks', icon: ListChecks },
  { to: '/schedules', label: 'schedules', icon: CalendarClock },
  { to: '/executions', label: 'executions', icon: Activity },
  { to: '/credentials', label: 'credentials', icon: KeyRound },
] as const

const adminNav = [
  { to: '/admin/users', label: 'users', icon: Users },
  { to: '/admin/audit', label: 'audit', icon: ScrollText },
] as const

type RoutePath =
  | '/dashboard'
  | '/tasks'
  | '/schedules'
  | '/executions'
  | '/credentials'
  | '/admin/users'
  | '/admin/audit'

function NavLink({
  to,
  label,
  icon: Icon,
}: {
  to: RoutePath
  label: string
  icon: typeof Gauge
}): React.ReactNode {
  const { t } = useTranslation()
  return (
    <Link
      to={to}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
      )}
      activeProps={{ className: 'bg-muted text-foreground' }}
    >
      <Icon className="h-4 w-4" />
      {t(`nav.${label}`)}
    </Link>
  )
}

export function Sidebar(): React.ReactNode {
  const { user } = useAuth()
  const { t } = useTranslation()
  const showAdmin = user?.isSuperadmin === true || user?.role === 'admin' || user?.role === 'owner'

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-card">
      <div className="flex h-14 items-center gap-2 border-b border-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-white">
          <ShieldCheck className="h-4 w-4" />
        </div>
        <span className="text-sm font-semibold tracking-tight">{t('app.name')}</span>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {baseNav.map((item) => (
          <NavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
        ))}
        {showAdmin && (
          <>
            <p className="px-3 pb-1 pt-4 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('nav.admin')}
            </p>
            {adminNav.map((item) => (
              <NavLink key={item.to} to={item.to} label={item.label} icon={item.icon} />
            ))}
          </>
        )}
      </nav>
    </aside>
  )
}

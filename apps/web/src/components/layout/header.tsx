import { useTranslation } from 'react-i18next'
import { LogOut, Moon, Sun, User } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import { useTheme } from '@/hooks/useTheme'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { setLanguage, SUPPORTED_LANGUAGES } from '@/lib/i18n'

export function Header(): React.ReactNode {
  const { user, logout } = useAuth()
  const { resolvedTheme, toggle } = useTheme()
  const { t, i18n } = useTranslation()

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <div className="text-sm text-muted-foreground">
        {user?.displayName !== undefined ? `@${user.displayName}` : ''}
      </div>
      <div className="flex items-center gap-2">
        <Select
          value={i18n.language.startsWith('zh') ? 'zh' : 'en'}
          onValueChange={(v) => setLanguage(v === 'en' ? 'en' : 'zh')}
        >
          <SelectTrigger className="h-8 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((lang) => (
              <SelectItem key={lang} value={lang}>
                {lang === 'zh' ? '中文' : 'EN'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="icon" onClick={toggle} aria-label="Toggle theme">
          {resolvedTheme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon">
              <User className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <p className="text-sm font-medium">{user?.displayName ?? user?.email}</p>
              <p className="text-xs font-normal text-muted-foreground">{user?.email}</p>
              <p className="mt-1 inline-flex rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {user?.role}
              </p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                void logout()
              }}
            >
              <LogOut className="h-4 w-4" />
              {t('nav.signOut')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  )
}

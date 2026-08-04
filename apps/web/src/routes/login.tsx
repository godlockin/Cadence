import { useEffect, useState } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/hooks/useAuth'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/login')({ component: LoginPage })

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})
type LoginValues = z.infer<typeof LoginSchema>

function LoginPage(): React.ReactNode {
  const { t } = useTranslation()
  const { login, isAuthenticated } = useAuth()
  const navigate = useNavigate()
  const [serverError, setServerError] = useState('')
  const form = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  })

  useEffect(() => {
    if (isAuthenticated) void navigate({ to: '/dashboard', replace: true })
  }, [isAuthenticated, navigate])

  const onSubmit = async (values: LoginValues): Promise<void> => {
    setServerError('')
    try {
      await login(values.email, values.password)
      void navigate({ to: '/dashboard', replace: true })
    } catch (err: unknown) {
      setServerError(errorMessage(err))
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent text-white">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('auth.loginTitle')}</h1>
          <p className="text-sm text-muted-foreground">{t('auth.loginSubtitle')}</p>
        </div>
        <form
          onSubmit={form.handleSubmit(onSubmit)}
          className="space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm"
        >
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            {form.formState.errors.email !== undefined && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
            {form.formState.errors.password !== undefined && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          {serverError !== '' && <p className="text-xs text-destructive">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              t('auth.login')
            )}
          </Button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          {t('auth.noAccount')}{' '}
          <Link to="/register" className="font-medium text-accent hover:underline">
            {t('auth.register')}
          </Link>
        </p>
      </div>
    </div>
  )
}

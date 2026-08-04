import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ReactNode
}

interface ErrorInfo {
  message: string
  stack?: string
}

class GlobalErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  { hasError: boolean; error: ErrorInfo | null }
> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: unknown): { hasError: boolean; error: ErrorInfo } {
    return {
      hasError: true,
      error: {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    }
  }

  override componentDidCatch(error: unknown, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback !== undefined) return this.props.fallback
      return <DefaultErrorFallback error={this.state.error} onReset={this.handleReset} />
    }
    return this.props.children
  }

  private handleReset = (): void => {
    this.setState({ hasError: false, error: null })
  }
}

function DefaultErrorFallback({
  error,
  onReset,
}: {
  error: ErrorInfo | null
  onReset: () => void
}): React.ReactNode {
  const { t } = useTranslation()
  const { toast } = useToast()

  const handleReport = React.useCallback(() => {
    const text = `[PulseDeck Error]\n\nMessage: ${error?.message ?? 'unknown'}\n\nStack:\n${error?.stack ?? 'no stack'}`
    navigator.clipboard.writeText(text).then(() => {
      toast({ description: 'Error details copied to clipboard', variant: 'info' })
    })
  }, [error, toast])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-destructive/10">
        <AlertTriangle className="h-8 w-8 text-destructive" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl font-semibold">{t('errors.somethingWentWrong')}</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {error?.message ?? t('errors.unknown')}
        </p>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={handleReport}>
          {t('errors.copyError')}
        </Button>
        <Button onClick={onReset}>
          <RefreshCw className="h-4 w-4" />
          {t('errors.reload')}
        </Button>
      </div>
    </div>
  )
}

export { GlobalErrorBoundary as ErrorBoundary }

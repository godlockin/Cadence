import * as React from 'react'
import * as ToastPrimitive from '@radix-ui/react-toast'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastVariant = 'default' | 'success' | 'error' | 'warn' | 'info'

interface Toast {
  id: string
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (props: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

const ToastContext = React.createContext<ToastContextValue | null>(null)

const variantClasses: Record<ToastVariant, string> = {
  default: '',
  success: 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950',
  error: 'border-red-500/30 bg-red-50 dark:bg-red-950',
  warn: 'border-amber-500/30 bg-amber-50 dark:bg-amber-950',
  info: 'border-blue-500/30 bg-blue-50 dark:bg-blue-950',
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactNode {
  const [toasts, setToasts] = React.useState<Toast[]>([])

  const toast = React.useCallback((props: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { ...props, id }])
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      <ToastPrimitive.Provider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastPrimitive.Root
            key={t.id}
            duration={t.duration ?? 5000}
            onOpenChange={(open: boolean) => {
              if (!open) dismiss(t.id)
            }}
            className={cn(
              'group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-xl border p-4 pr-8 shadow-lg transition-all',
              'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-full',
              'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-full',
              'bg-card text-card-foreground',
              t.variant !== undefined ? variantClasses[t.variant] : '',
            )}
          >
            <div className="flex flex-col gap-1">
              {t.title !== undefined && (
                <ToastPrimitive.Title className="text-sm font-semibold">
                  {t.title}
                </ToastPrimitive.Title>
              )}
              {t.description !== undefined && (
                <ToastPrimitive.Description className="text-sm text-muted-foreground">
                  {t.description}
                </ToastPrimitive.Description>
              )}
            </div>
            <ToastPrimitive.Close
              aria-label="Close"
              className="absolute right-2 top-2 rounded-sm opacity-0 transition-opacity hover:opacity-100 focus:opacity-100 group-hover:opacity-100"
            >
              <X className="h-4 w-4" />
            </ToastPrimitive.Close>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-4 right-4 z-[100] flex max-w-md flex-col gap-2" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (ctx === null) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ThemeProvider } from 'next-themes'
import { I18nextProvider } from 'react-i18next'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToastProvider } from '@/components/ui/toast'
import { ErrorBoundary } from '@/components/composite/error-boundary'
import { AuthProvider } from '@/features/auth/AuthContext'
import { router } from '@/router'
import { queryClient } from '@/lib/queryClient'
import { i18n } from '@/lib/i18n'
import './styles/globals.css'

const rootEl = document.getElementById('root')
if (rootEl === null) throw new Error('Root element #root not found')

// i18n.init() runs synchronously (initImmediate: true, bundled resources).
// Switch to stored language preference before first render.
const stored = localStorage.getItem('pulsedeck.lang')
if (stored === 'zh' || stored === 'en') void i18n.changeLanguage(stored)

createRoot(rootEl).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <TooltipProvider delayDuration={200}>
              <ToastProvider>
                <AuthProvider>
                  <RouterProvider router={router} />
                </AuthProvider>
              </ToastProvider>
            </TooltipProvider>
          </ThemeProvider>
        </I18nextProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>,
)

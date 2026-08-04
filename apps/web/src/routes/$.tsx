import { Link, createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { FileQuestion } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const Route = createFileRoute('/$')({ component: NotFoundPage })

function NotFoundPage(): React.ReactNode {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 py-24 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileQuestion className="h-7 w-7" />
      </div>
      <div>
        <h1 className="text-2xl font-semibold">{t('notFound.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('notFound.message')}</p>
      </div>
      <Link to="/dashboard">
        <Button variant="outline" size="sm">
          {t('notFound.home')}
        </Button>
      </Link>
    </div>
  )
}

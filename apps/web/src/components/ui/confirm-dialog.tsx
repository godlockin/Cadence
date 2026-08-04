import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { AlertTriangle } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title?: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'destructive'
  onConfirm: () => void
  isPending?: boolean
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  isPending = false,
}: ConfirmDialogProps): React.ReactNode {
  const { t } = useTranslation()

  const resolvedTitle = title ?? t('confirm.title')
  const resolvedDesc = description ?? t('confirm.description')
  const resolvedConfirm = confirmLabel ?? t('common.confirm')
  const resolvedCancel = cancelLabel ?? t('common.cancel')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            {variant === 'destructive' && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
            )}
            <div>
              <DialogTitle>{resolvedTitle}</DialogTitle>
              {resolvedDesc && (
                <DialogDescription className="mt-1">{resolvedDesc}</DialogDescription>
              )}
            </div>
          </div>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            {resolvedCancel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            onClick={() => {
              onConfirm()
            }}
            disabled={isPending}
          >
            {isPending ? t('common.loading') : resolvedConfirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

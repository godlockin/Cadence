import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { TaskStatus } from '@/lib/types'

const variantMap: Record<
  TaskStatus,
  'default' | 'secondary' | 'success' | 'danger' | 'warning' | 'accent'
> = {
  success: 'success',
  failed: 'danger',
  running: 'accent',
  pending: 'secondary',
  scheduled: 'warning',
  queued: 'warning',
  dispatched: 'accent',
  cancelled: 'secondary',
  suspended: 'warning',
}

export function StatusBadge({ status }: { status: TaskStatus }): React.ReactNode {
  const { t } = useTranslation()
  const variant = variantMap[status] ?? 'secondary'
  return <Badge variant={variant}>{t(`status.${status}`)}</Badge>
}

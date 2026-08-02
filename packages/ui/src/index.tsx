/**
 * @pulsedeck/ui — shadcn-derived shared components.
 * PHASE 0: placeholder. Real components land in PHASE 1+.
 */
import type { ReactNode } from 'react'

export interface SlotProps {
  readonly children?: ReactNode
  readonly className?: string
}

export function Slot({ children, className: _className }: SlotProps): ReactNode {
  return children
}

export const VERSION = '0.1.0'

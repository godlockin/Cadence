import * as React from 'react'
import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

export type SSEConnectionStatus = 'connected' | 'reconnecting' | 'disconnected'

interface SSEStatusIndicatorProps {
  status: SSEConnectionStatus
  className?: string
}

const statusConfig: Record<
  SSEConnectionStatus,
  {
    icon: React.ReactNode
    label: string
    dotColor: string
  }
> = {
  connected: {
    icon: <Wifi className="h-3.5 w-3.5" />,
    label: 'SSE connected',
    dotColor: 'bg-emerald-500',
  },
  reconnecting: {
    icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
    label: 'Reconnecting...',
    dotColor: 'bg-amber-500',
  },
  disconnected: {
    icon: <WifiOff className="h-3.5 w-3.5" />,
    label: 'Disconnected',
    dotColor: 'bg-red-500',
  },
}

export function SSEStatusIndicator({
  status,
  className,
}: SSEStatusIndicatorProps): React.ReactNode {
  const config = statusConfig[status]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={`flex items-center gap-1.5 ${className ?? ''}`}>
          <span className={`h-2 w-2 rounded-full ${config.dotColor}`} />
          {config.icon}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <p>{config.label}</p>
      </TooltipContent>
    </Tooltip>
  )
}

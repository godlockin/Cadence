import * as React from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useToast } from '@/components/ui/toast'

interface CopyButtonProps {
  value: string
  displayValue?: string
  className?: string
}

export function CopyButton({ value, displayValue, className }: CopyButtonProps): React.ReactNode {
  const { toast } = useToast()
  const [copied, setCopied] = React.useState(false)

  const handleCopy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast({ title: undefined, description: displayValue ?? value, variant: 'success' })
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast({ title: undefined, description: 'Copy failed', variant: 'error' })
    }
  }, [value, displayValue, toast])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={className}
          onClick={handleCopy}
          aria-label={copied ? 'Copied' : 'Copy to clipboard'}
        >
          {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{copied ? 'Copied!' : 'Copy'}</p>
      </TooltipContent>
    </Tooltip>
  )
}

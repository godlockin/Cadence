/**
 * Wizard - Multi-step wizard component for guided task creation.
 */
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface WizardStep {
  id: string
  titleKey: string
  descriptionKey?: string
  content: React.ReactNode
  isValid?: () => boolean
}

interface WizardProps {
  steps: WizardStep[]
  onComplete: (data: Record<string, unknown>) => void
  onCancel?: () => void
  storageKey?: string
}

export function Wizard({
  steps,
  onComplete,
  onCancel,
  storageKey = 'wizard-data',
}: WizardProps): React.ReactNode {
  const [currentStep, setCurrentStep] = useState(0)
  const [stepData, setStepData] = useState<Record<string, unknown>>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        try {
          return JSON.parse(saved)
        } catch {
          return {}
        }
      }
    }
    return {}
  })

  // Persist data to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(stepData))
    }
  }, [stepData, storageKey])

  const step = steps[currentStep]!
  const canGoNext = step.isValid === undefined || step.isValid()
  const isFirst = currentStep === 0
  const isLast = currentStep === steps.length - 1

  const handleNext = (): void => {
    if (isLast) {
      onComplete(stepData)
      if (typeof window !== 'undefined') {
        localStorage.removeItem(storageKey)
      }
    } else {
      setCurrentStep((s) => s + 1)
    }
  }

  const handleBack = (): void => {
    if (isFirst) {
      onCancel?.()
    } else {
      setCurrentStep((s) => s - 1)
    }
  }

  const _updateData = (data: Record<string, unknown>): void => {
    setStepData((prev) => ({ ...prev, ...data }))
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {steps.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                i === currentStep
                  ? 'bg-primary text-primary-foreground'
                  : i < currentStep
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {i + 1}
            </div>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          {currentStep + 1} / {steps.length}
        </span>
      </div>

      {/* Step title */}
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">{step!.titleKey}</h2>
        {step!.descriptionKey && (
          <p className="text-sm text-muted-foreground">{step!.descriptionKey}</p>
        )}
      </div>

      {/* Step content */}
      <div className="min-h-[300px]">{step!.content}</div>

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button type="button" variant="ghost" onClick={handleBack}>
          <ChevronLeft className="h-4 w-4 mr-1" />
          {isFirst ? 'Cancel' : 'Back'}
        </Button>
        <Button type="button" onClick={handleNext} disabled={!canGoNext}>
          {isLast ? (
            'Complete'
          ) : (
            <>
              Next
              <ChevronRight className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}

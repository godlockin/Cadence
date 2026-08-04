/**
 * CronPicker - Human-friendly cron configuration component.
 *
 * Simple mode: dropdown frequency + time picker + weekday multi-select
 * Advanced mode: raw cron expression input with preview
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  buildCron,
  formatAbsoluteTime,
  formatRelativeTime,
  getNextOccurrence,
  parseCron,
  type CronOptions,
  type Frequency,
} from '@/lib/cron'

const FREQUENCY_OPTIONS: Array<{ value: Frequency; labelKey: string }> = [
  { value: 'hourly', labelKey: 'cron.hourly' },
  { value: 'daily', labelKey: 'cron.daily' },
  { value: 'weekly', labelKey: 'cron.weekly' },
  { value: 'monthly', labelKey: 'cron.monthly' },
  { value: 'custom', labelKey: 'cron.custom' },
]

const WEEKDAYS = [
  { value: 0, labelKey: 'cron.sun' },
  { value: 1, labelKey: 'cron.mon' },
  { value: 2, labelKey: 'cron.tue' },
  { value: 3, labelKey: 'cron.wed' },
  { value: 4, labelKey: 'cron.thu' },
  { value: 5, labelKey: 'cron.fri' },
  { value: 6, labelKey: 'cron.sat' },
]

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]

interface CronPickerProps {
  value: string
  onChange: (cron: string) => void
  showAdvanced?: boolean
  className?: string
}

export function CronPicker({
  value,
  onChange,
  showAdvanced = false,
  className,
}: CronPickerProps): React.ReactNode {
  const { t } = useTranslation()
  const [showAdvancedMode, setShowAdvancedMode] = useState(showAdvanced)
  const [options, setOptions] = useState<CronOptions>(() => parseCron(value))
  const [advancedText, setAdvancedText] = useState(value)
  const [nextOccurrence, setNextOccurrence] = useState<number | null>(null)

  // Sync external value changes
  useEffect(() => {
    if (!showAdvancedMode) {
      setOptions(parseCron(value))
    }
  }, [value, showAdvancedMode])

  // Calculate next occurrence whenever cron changes
  useEffect(() => {
    const cron = showAdvancedMode ? advancedText : buildCron(options)
    const next = getNextOccurrence(cron)
    setNextOccurrence(next)
  }, [options, advancedText, showAdvancedMode])

  const handleFrequencyChange = (frequency: Frequency): void => {
    const next: CronOptions = { ...options, frequency }
    // Set sensible defaults
    if (frequency === 'weekly' && !options.daysOfWeek) {
      next.daysOfWeek = [1]
    }
    if (frequency === 'monthly' && !options.dayOfMonth) {
      next.dayOfMonth = 1
    }
    setOptions(next)
    onChange(buildCron(next))
  }

  const handleHourChange = (hour: number): void => {
    const next = { ...options, hour }
    setOptions(next)
    onChange(buildCron(next))
  }

  const handleMinuteChange = (minute: number): void => {
    const next = { ...options, minute }
    setOptions(next)
    onChange(buildCron(next))
  }

  const handleDayToggle = (day: number, checked: boolean): void => {
    const days = checked
      ? [...(options.daysOfWeek ?? []), day].sort()
      : (options.daysOfWeek ?? []).filter((d) => d !== day)
    const next = { ...options, daysOfWeek: days.length > 0 ? days : [1] }
    setOptions(next)
    onChange(buildCron(next))
  }

  const handleDayOfMonthChange = (day: number): void => {
    const next = { ...options, dayOfMonth: Math.max(1, Math.min(31, day)) }
    setOptions(next)
    onChange(buildCron(next))
  }

  const handleAdvancedChange = (text: string): void => {
    setAdvancedText(text)
    onChange(text)
  }

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-3">
        {/* Frequency selector */}
        <div className="space-y-1.5">
          <Label>{t('cron.frequency')}</Label>
          <Select
            value={options.frequency}
            onValueChange={(v) => handleFrequencyChange(v as Frequency)}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {FREQUENCY_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {t(opt.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Time picker (not for hourly) */}
        {options.frequency !== 'hourly' && options.frequency !== 'custom' && (
          <div className="space-y-1.5">
            <Label>{t('cron.time')}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={String(options.hour ?? 9)}
                onValueChange={(v) => handleHourChange(parseInt(v, 10))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h} value={String(h)}>
                      {String(h).padStart(2, '0')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-muted-foreground">:</span>
              <Select
                value={String(options.minute ?? 0)}
                onValueChange={(v) => handleMinuteChange(parseInt(v, 10))}
              >
                <SelectTrigger className="w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MINUTES.map((m) => (
                    <SelectItem key={m} value={String(m)}>
                      {String(m).padStart(2, '0')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Hourly minute picker */}
        {options.frequency === 'hourly' && (
          <div className="space-y-1.5">
            <Label>{t('cron.atMinute')}</Label>
            <Select
              value={String(options.minute ?? 0)}
              onValueChange={(v) => handleMinuteChange(parseInt(v, 10))}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t('cron.minuteLabel', { minute: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Weekday picker */}
        {options.frequency === 'weekly' && (
          <div className="space-y-1.5">
            <Label>{t('cron.daysOfWeek')}</Label>
            <div className="flex flex-wrap gap-3">
              {WEEKDAYS.map((day) => (
                <div key={day.value} className="flex items-center gap-1.5">
                  <Checkbox
                    id={`weekday-${day.value}`}
                    checked={(options.daysOfWeek ?? []).includes(day.value)}
                    onCheckedChange={(checked) => handleDayToggle(day.value, Boolean(checked))}
                  />
                  <Label
                    htmlFor={`weekday-${day.value}`}
                    className="text-sm font-normal cursor-pointer"
                  >
                    {t(day.labelKey)}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Day of month picker */}
        {options.frequency === 'monthly' && (
          <div className="space-y-1.5">
            <Label>{t('cron.dayOfMonth')}</Label>
            <Input
              type="number"
              min={1}
              max={31}
              value={options.dayOfMonth ?? 1}
              onChange={(e) => handleDayOfMonthChange(parseInt(e.target.value, 10) || 1)}
              className="w-24"
            />
          </div>
        )}

        {/* Custom cron input */}
        {options.frequency === 'custom' && (
          <div className="space-y-1.5">
            <Label htmlFor="custom-cron">{t('cron.expression')}</Label>
            <Input
              id="custom-cron"
              value={advancedText}
              onChange={(e) => handleAdvancedChange(e.target.value)}
              placeholder="0 9 * * *"
              className="font-mono"
            />
          </div>
        )}
      </div>

      {/* Advanced toggle */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setShowAdvancedMode((v) => !v)}
        className="text-xs"
      >
        {showAdvancedMode ? (
          <>
            <ChevronUp className="h-3 w-3 mr-1" />
            {t('cron.hideAdvanced')}
          </>
        ) : (
          <>
            <ChevronDown className="h-3 w-3 mr-1" />
            {t('cron.showAdvanced')}
          </>
        )}
      </Button>

      {/* Advanced mode raw input */}
      {showAdvancedMode && (
        <div className="space-y-1.5 rounded-lg border border-border p-3">
          <Label htmlFor="advanced-cron">{t('cron.advancedMode')}</Label>
          <Input
            id="advanced-cron"
            value={advancedText}
            onChange={(e) => handleAdvancedChange(e.target.value)}
            placeholder="0 9 * * 1-5"
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">{t('cron.formatHint')}</p>
        </div>
      )}

      {/* Preview */}
      {nextOccurrence !== null && (
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm">
          <Clock className="h-4 w-4 text-muted-foreground" />
          <span className="text-muted-foreground">{t('cron.nextRun')}:</span>
          <span className="font-medium">
            {formatAbsoluteTime(nextOccurrence)}
            <span className="ml-2 text-muted-foreground">
              ({t('cron.inX', { time: formatRelativeTime(nextOccurrence) })})
            </span>
          </span>
        </div>
      )}
    </div>
  )
}

/**
 * New task wizard - Guided 4-step task creation.
 *
 * Step 1: Choose template (6 presets + blank)
 * Step 2: Basic info (name, description, tags)
 * Step 3: Configure schedule (CronPicker)
 * Step 4: Configure execution (payload)
 * Step 5: Review & save
 */
import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import {
  Activity,
  ArrowLeft,
  Database,
  Globe,
  Plus,
  Rss,
  Share2,
  Webhook as WebhookIcon,
} from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { CronPicker } from '@/components/composite/cron-picker'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { useCreateTask, useTriggerTask } from '@/features/tasks/hooks'
import { buildTemplatePayload, getTemplate, TASK_TEMPLATES } from '@/features/tasks/templates'
import { errorMessage } from '@/lib/api'

export const Route = createFileRoute('/tasks/new')({ component: NewTaskPage })

const TEMPLATE_ICONS: Record<string, React.ReactNode> = {
  Globe: <Globe className="h-6 w-6" />,
  Rss: <Rss className="h-6 w-6" />,
  Activity: <Activity className="h-6 w-6" />,
  Database: <Database className="h-6 w-6" />,
  Share2: <Share2 className="h-6 w-6" />,
  Webhook: <WebhookIcon className="h-6 w-6" />,
}

function NewTaskPage(): React.ReactNode {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const createTask = useCreateTask()
  const triggerTask = useTriggerTask()
  const [step, setStep] = useState(1)
  const [errorMsg, setErrorMsg] = useState('')

  // Step 1: Template selection
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)

  // Step 2: Basic info
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')

  // Step 3: Schedule
  const [cron, setCron] = useState('0 9 * * *')
  const [timezone, setTimezone] = useState('Asia/Shanghai')

  // Step 4: Template fields (dynamic based on template)
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})

  // Step 5: Review / submit
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [testRunning, setTestRunning] = useState(false)

  const selectedTemplate = selectedTemplateId ? getTemplate(selectedTemplateId) : undefined

  const canGoNext = (): boolean => {
    switch (step) {
      case 1:
        return true // template can be null (blank)
      case 2:
        return name.trim().length > 0
      case 3:
        return true
      case 4:
        if (!selectedTemplate) return true
        return selectedTemplate.fields.every((f) => !f.required || fieldValues[f.key]?.trim())
      default:
        return true
    }
  }

  const handleNext = (): void => {
    if (step < 5) setStep(step + 1)
  }

  const handleBack = (): void => {
    if (step > 1) setStep(step - 1)
  }

  const buildPayload = (): Record<string, unknown> => {
    if (!selectedTemplate) {
      return { method: 'GET', url: '', headers: {}, timeoutMs: 10000 }
    }
    return buildTemplatePayload(selectedTemplate, fieldValues)
  }

  const handleSubmit = async (runTest = false): Promise<void> => {
    setIsSubmitting(true)
    setErrorMsg('')
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        payloadKind: selectedTemplate?.payloadKind ?? 'http',
        triggerKind: selectedTemplate?.triggerKind ?? 'cron',
        cron: selectedTemplate?.triggerKind === 'webhook' ? null : cron,
        timezone,
        maxRetries: selectedTemplate?.maxRetries ?? 0,
        retryBackoff: 'exponential',
        concurrencyPolicy: 'skip',
        jitterMs: 0,
        timeoutMs: selectedTemplate?.timeoutMs ?? 30000,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        payload: buildPayload(),
        triggerConfig: {},
      }

      const task = await createTask.mutateAsync(body)

      if (runTest) {
        setTestRunning(true)
        try {
          const { executionId } = await triggerTask.mutateAsync(task.id)
          void navigate({ to: '/executions/$id', params: { id: executionId }, replace: true })
        } catch {
          void navigate({ to: '/tasks/$id', params: { id: task.id }, replace: true })
        } finally {
          setTestRunning(false)
        }
      } else {
        void navigate({ to: '/tasks/$id', params: { id: task.id }, replace: true })
      }
    } catch (e: unknown) {
      setErrorMsg(errorMessage(e))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t('tasks.newTask')}>
        <Link
          to="/tasks"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> {t('common.back')}
        </Link>
      </PageHeader>

      {errorMsg !== '' && <p className="text-sm text-destructive">{errorMsg}</p>}

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium transition-colors',
                s === step
                  ? 'bg-primary text-primary-foreground'
                  : s < step
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {s}
            </div>
          ))}
        </div>
        <span className="text-sm text-muted-foreground">Step {step} of 5</span>
      </div>

      {/* Step 1: Template selection */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('wizard.step1Title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.step1Desc')}</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Blank template */}
            <Card
              className={cn(
                'cursor-pointer transition-colors hover:border-primary',
                selectedTemplateId === null && 'border-primary bg-primary/5',
              )}
              onClick={() => {
                setSelectedTemplateId(null)
                setFieldValues({})
              }}
            >
              <CardContent className="flex items-center gap-3 p-4">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                  <Plus className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-medium">{t('wizard.blankTemplate')}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('templates.domainExpiry.desc')}
                  </p>
                </div>
              </CardContent>
            </Card>

            {/* Preset templates */}
            {TASK_TEMPLATES.map((template) => (
              <Card
                key={template.id}
                className={cn(
                  'cursor-pointer transition-colors hover:border-primary',
                  selectedTemplateId === template.id && 'border-primary bg-primary/5',
                )}
                onClick={() => {
                  setSelectedTemplateId(template.id)
                  setCron(template.cron ?? '0 9 * * *')
                }}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                    {TEMPLATE_ICONS[template.icon] ?? <Activity className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="font-medium">{t(template.nameKey)}</p>
                    <p className="text-xs text-muted-foreground">{t(template.descriptionKey)}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Basic info */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('wizard.step2Title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.step2Desc')}</p>
          </div>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="task-name">{t('common.name')} *</Label>
              <Input
                id="task-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t('wizard.namePlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-desc">{t('common.description')}</Label>
              <Textarea
                id="task-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t('wizard.descPlaceholder')}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="task-tags">{t('tasks.tags')}</Label>
              <Input
                id="task-tags"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t('wizard.tagsPlaceholder')}
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 3: Schedule */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('wizard.step3Title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.step3Desc')}</p>
          </div>
          <div className="space-y-4">
            <CronPicker value={cron} onChange={setCron} />
            <div className="space-y-1.5">
              <Label htmlFor="timezone">{t('tasks.timezone')}</Label>
              <Input
                id="timezone"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="Asia/Shanghai"
              />
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Template fields */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('wizard.step4Title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.step4Desc')}</p>
          </div>
          {selectedTemplate ? (
            <div className="space-y-4">
              <p className="text-sm">
                Configure <span className="font-medium">{t(selectedTemplate.nameKey)}</span>:
              </p>
              {selectedTemplate.fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`field-${field.key}`}>
                    {t(field.labelKey)}
                    {field.required && ' *'}
                  </Label>
                  {field.type === 'select' && field.options ? (
                    <select
                      id={`field-${field.key}`}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldValues((v) => ({ ...v, [field.key]: e.target.value }))
                      }
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    >
                      <option value="">Select...</option>
                      {field.options.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={`field-${field.key}`}
                      type={field.type}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldValues((v) => ({ ...v, [field.key]: e.target.value }))
                      }
                      placeholder={field.placeholder}
                    />
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                No template selected. You can configure the task payload after creation.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Step 5: Review */}
      {step === 5 && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold">{t('wizard.step5Title')}</h2>
            <p className="text-sm text-muted-foreground">{t('wizard.step5Desc')}</p>
          </div>
          <Card>
            <CardContent className="space-y-3 p-4">
              <div>
                <p className="text-xs text-muted-foreground">{t('common.name')}</p>
                <p className="font-medium">{name}</p>
              </div>
              {description && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('common.description')}</p>
                  <p className="text-sm">{description}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted-foreground">{t('tasks.cron')}</p>
                <p className="font-mono text-sm">{cron}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{t('tasks.timezone')}</p>
                <p className="text-sm">{timezone}</p>
              </div>
              {selectedTemplate && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('wizard.selectTemplate')}</p>
                  <p className="text-sm">{t(selectedTemplate.nameKey)}</p>
                </div>
              )}
              {tags && (
                <div>
                  <p className="text-xs text-muted-foreground">{t('tasks.tags')}</p>
                  <p className="text-sm">{tags}</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          onClick={step === 1 ? () => void navigate({ to: '/tasks' }) : handleBack}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          {step === 1 ? t('common.cancel') : 'Back'}
        </Button>
        <div className="flex items-center gap-2">
          {step === 5 && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleSubmit(true)}
              disabled={isSubmitting || testRunning}
            >
              {testRunning ? t('wizard.testRunning') : t('wizard.testTask')}
            </Button>
          )}
          <Button
            type="button"
            onClick={step === 5 ? () => void handleSubmit(false) : handleNext}
            disabled={!canGoNext() || isSubmitting}
          >
            {step === 5 ? t('wizard.createTask') : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}

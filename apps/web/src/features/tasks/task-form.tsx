import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import {
  ConcurrencyPolicySchema,
  PayloadKindSchema,
  RetryBackoffSchema,
  TriggerKindSchema,
} from '@cadence/domain'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CronPicker } from '@/components/composite/cron-picker'
import {
  PipelineEditor,
  emptyPipelinePayload,
  isPipelinePayload,
  type PipelinePayload,
} from './pipeline-editor'
import type { Task } from '@/lib/types'

const PAYLOAD_EXAMPLES = {
  'GET https://api.example.com/health':
    '{\n  "url": "https://api.example.com/health",\n  "method": "GET",\n  "headers": {},\n  "timeoutMs": 10000\n}',
  'POST https://api.example.com/login':
    '{\n  "url": "https://api.example.com/login",\n  "method": "POST",\n  "headers": { "Content-Type": "application/json" },\n  "body": { "username": "demo", "password": "demo" },\n  "timeoutMs": 10000\n}',
  'PUT https://api.example.com/resource/123':
    '{\n  "url": "https://api.example.com/resource/123",\n  "method": "PUT",\n  "headers": { "Content-Type": "application/json" },\n  "body": { "name": "updated", "status": "active" },\n  "timeoutMs": 10000\n}',
  'DELETE https://api.example.com/resource/123':
    '{\n  "url": "https://api.example.com/resource/123",\n  "method": "DELETE",\n  "headers": {},\n  "timeoutMs": 10000\n}',
  'POST with bearer token':
    '{\n  "url": "https://api.example.com/protected",\n  "method": "POST",\n  "headers": { "Authorization": "Bearer YOUR_TOKEN" },\n  "body": {},\n  "timeoutMs": 10000\n}',
} as const satisfies Record<string, string>

const TASK_EXAMPLES: Array<{ label: string; values: Partial<TaskFormValues>; payload: string }> = [
  {
    label: '每日签到 (POST, 北京时间 8:00)',
    values: {
      name: '每日签到',
      payloadKind: 'http',
      triggerKind: 'cron',
      cron: '0 8 * * *',
      timezone: 'Asia/Shanghai',
      maxRetries: 1,
      timeoutMs: 15000,
      tags: 'daily, checkin',
    },
    payload: PAYLOAD_EXAMPLES['POST https://api.example.com/login'] ?? '',
  },
  {
    label: '健康检查 (GET, 每 5 分钟)',
    values: {
      name: '健康检查',
      payloadKind: 'http',
      triggerKind: 'cron',
      cron: '*/5 * * * *',
      timezone: 'Asia/Shanghai',
      maxRetries: 3,
      retryBackoff: 'exponential',
      timeoutMs: 5000,
      tags: 'health',
    },
    payload: PAYLOAD_EXAMPLES['GET https://api.example.com/health'] ?? '',
  },
  {
    label: 'API 写操作 (PUT)',
    values: {
      name: '更新资源',
      payloadKind: 'http',
      triggerKind: 'manual',
      cron: '',
      timezone: 'Asia/Shanghai',
      maxRetries: 0,
      timeoutMs: 15000,
      tags: 'manual',
    },
    payload: PAYLOAD_EXAMPLES['PUT https://api.example.com/resource/123'] ?? '',
  },
  {
    label: 'Bearer Token POST',
    values: {
      name: '授权 API 调用',
      payloadKind: 'http',
      triggerKind: 'cron',
      cron: '0 9 * * 1',
      timezone: 'Asia/Shanghai',
      maxRetries: 2,
      timeoutMs: 15000,
      tags: 'weekly',
    },
    payload: PAYLOAD_EXAMPLES['POST with bearer token'] ?? '',
  },
]

const TaskFormSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().default(''),
  payloadKind: PayloadKindSchema,
  triggerKind: TriggerKindSchema,
  cron: z.string().optional().default(''),
  timezone: z.string().optional().default('Asia/Shanghai'),
  maxRetries: z.coerce.number().int().min(0).max(100).default(0),
  retryBackoff: RetryBackoffSchema,
  concurrencyPolicy: ConcurrencyPolicySchema,
  jitterMs: z.coerce.number().int().min(0).max(86_400_000).default(0),
  timeoutMs: z.coerce.number().int().min(100).max(86_400_000).default(30_000),
  tags: z.string().optional().default(''),
})
type TaskFormValues = z.infer<typeof TaskFormSchema>

const PAYLOAD_KINDS = PayloadKindSchema.options as readonly string[]
const TRIGGER_KINDS = TriggerKindSchema.options as readonly string[]
const RETRY_BACKOFFS = RetryBackoffSchema.options as readonly string[]
const CONCURRENCY_POLICIES = ConcurrencyPolicySchema.options as readonly string[]

function parseJsonObject(text: string): { ok: boolean; value: Record<string, unknown> } {
  const trimmed = text.trim()
  if (trimmed.length === 0) return { ok: true, value: {} }
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { ok: false, value: {} }
    }
    return { ok: true, value: parsed as Record<string, unknown> }
  } catch {
    return { ok: false, value: {} }
  }
}

function toApiBody(
  values: TaskFormValues,
  extra: {
    payload: unknown
    triggerConfig: unknown
    expectedVersion?: number
  },
): Record<string, unknown> {
  const tags = values.tags
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
  return {
    name: values.name,
    description: values.description === '' ? undefined : values.description,
    payloadKind: values.payloadKind,
    payload: extra.payload,
    triggerKind: values.triggerKind,
    triggerConfig: extra.triggerConfig,
    cron: values.cron === '' ? null : values.cron,
    timezone: values.timezone === '' ? 'Asia/Shanghai' : values.timezone,
    maxRetries: values.maxRetries,
    retryBackoff: values.retryBackoff,
    concurrencyPolicy: values.concurrencyPolicy,
    jitterMs: values.jitterMs,
    timeoutMs: values.timeoutMs,
    tags,
    ...(extra.expectedVersion !== undefined ? { expectedVersion: extra.expectedVersion } : {}),
  }
}

interface TaskFormProps {
  initial?: Task
  isEdit: boolean
  onSubmit: (body: Record<string, unknown>) => Promise<void>
  onTest?: () => void
  onDelete?: () => void
  submitting?: boolean
}

export function TaskForm({
  initial,
  isEdit,
  onSubmit,
  onTest,
  onDelete,
  submitting = false,
}: TaskFormProps): React.ReactNode {
  const { t } = useTranslation()

  const initialPipeline = useMemo<PipelinePayload | null>(() => {
    if (initial === undefined) return null
    if (initial.payloadKind !== 'pipeline') return null
    return isPipelinePayload(initial.payload) ? initial.payload : emptyPipelinePayload()
  }, [initial])

  const defaultPayloadText = useMemo(
    () => JSON.stringify(initial?.payload ?? {}, null, 2),
    [initial],
  )
  const defaultTriggerText = useMemo(
    () => JSON.stringify(initial?.triggerConfig ?? {}, null, 2),
    [initial],
  )

  const form = useForm<TaskFormValues>({
    resolver: zodResolver(TaskFormSchema),
    defaultValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      payloadKind: initial?.payloadKind ?? 'http',
      triggerKind: initial?.triggerKind ?? 'manual',
      cron: initial?.cron ?? '',
      timezone: initial?.timezone ?? 'Asia/Shanghai',
      maxRetries: initial?.maxRetries ?? 0,
      retryBackoff: initial?.retryBackoff ?? 'exponential',
      concurrencyPolicy: initial?.concurrencyPolicy ?? 'skip',
      jitterMs: initial?.jitterMs ?? 0,
      timeoutMs: initial?.timeoutMs ?? 30_000,
      tags: (initial?.tags ?? []).join(', '),
    },
  })

  const payloadKind = form.watch('payloadKind')
  const [pipelinePayload, setPipelinePayload] = useState<PipelinePayload>(
    () => initialPipeline ?? emptyPipelinePayload(),
  )
  const [pipelineValid, setPipelineValid] = useState(true)
  const [payloadText, setPayloadText] = useState(defaultPayloadText)
  const [triggerText, setTriggerText] = useState(defaultTriggerText)
  const [payloadError, setPayloadError] = useState('')
  const [triggerError, setTriggerError] = useState('')

  const isPipelineMode = payloadKind === 'pipeline'

  // reset pipeline payload when switching to pipeline mode without initial
  useEffect(() => {
    if (isPipelineMode && initialPipeline === null) {
      setPipelinePayload(emptyPipelinePayload())
    }
  }, [isPipelineMode, initialPipeline])

  const buildPayload = (): unknown => {
    if (isPipelineMode) return pipelinePayload
    const { ok, value } = parseJsonObject(payloadText)
    if (!ok) return {}
    return value
  }

  const validateAndSubmit = async (values: TaskFormValues): Promise<void> => {
    if (isPipelineMode) {
      if (!pipelineValid) return
    } else {
      const { ok } = parseJsonObject(payloadText)
      if (!ok) {
        setPayloadError('Payload must be a valid JSON object')
        return
      }
    }
    const trigger = parseJsonObject(triggerText)
    if (!trigger.ok) {
      setTriggerError('Trigger config must be a valid JSON object')
      return
    }
    const body = toApiBody(values, {
      payload: buildPayload(),
      triggerConfig: trigger.value,
      ...(isEdit && initial !== undefined ? { expectedVersion: initial.version } : {}),
    })
    await onSubmit(body)
  }

  const payloadTextValid = useMemo(() => {
    if (isPipelineMode) return true
    const { ok, value } = parseJsonObject(payloadText)
    void value
    return ok
  }, [isPipelineMode, payloadText])

  const saveDisabled = submitting || (isPipelineMode ? !pipelineValid : !payloadTextValid)

  return (
    <form onSubmit={form.handleSubmit(validateAndSubmit)} className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="name">{t('common.name')}</Label>
          <Input id="name" placeholder="My task" {...form.register('name')} />
          {form.formState.errors.name !== undefined && (
            <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="description">{t('common.description')}</Label>
          <Input id="description" placeholder="Optional" {...form.register('description')} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label>{t('tasks.examples') ?? '示例'}</Label>
          <Select
            onValueChange={(v) => {
              const example = TASK_EXAMPLES.find((e) => e.label === v)
              if (example === undefined) return
              form.reset({ ...form.getValues(), ...example.values })
              setPayloadText(example.payload)
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="选择示例快速填充..." />
            </SelectTrigger>
            <SelectContent>
              {TASK_EXAMPLES.map((e) => (
                <SelectItem key={e.label} value={e.label}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('tasks.payloadKind')}</Label>
          <Select
            value={form.watch('payloadKind')}
            onValueChange={(v) =>
              form.setValue('payloadKind', v as TaskFormValues['payloadKind'], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYLOAD_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('tasks.triggerKind')}</Label>
          <Select
            value={form.watch('triggerKind')}
            onValueChange={(v) =>
              form.setValue('triggerKind', v as TaskFormValues['triggerKind'], {
                shouldValidate: true,
              })
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TRIGGER_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('tasks.cron')}</Label>
          <CronPicker value={form.watch('cron')} onChange={(v) => form.setValue('cron', v)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timezone">{t('tasks.timezone')}</Label>
          <Input id="timezone" placeholder="UTC" {...form.register('timezone')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="maxRetries">{t('tasks.maxRetries')}</Label>
          <Input id="maxRetries" type="number" {...form.register('maxRetries')} />
        </div>
        <div className="space-y-1.5">
          <Label>{t('tasks.retryBackoff')}</Label>
          <Select
            value={form.watch('retryBackoff')}
            onValueChange={(v) =>
              form.setValue('retryBackoff', v as TaskFormValues['retryBackoff'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETRY_BACKOFFS.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t('tasks.concurrency')}</Label>
          <Select
            value={form.watch('concurrencyPolicy')}
            onValueChange={(v) =>
              form.setValue('concurrencyPolicy', v as TaskFormValues['concurrencyPolicy'])
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONCURRENCY_POLICIES.map((k) => (
                <SelectItem key={k} value={k}>
                  {k}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="timeoutMs">{t('tasks.timeoutMs')}</Label>
          <Input id="timeoutMs" type="number" {...form.register('timeoutMs')} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="jitterMs">{t('tasks.jitterMs')}</Label>
          <Input id="jitterMs" type="number" {...form.register('jitterMs')} />
        </div>
        <div className="col-span-2 space-y-1.5">
          <Label htmlFor="tags">{t('tasks.tags')}</Label>
          <Input id="tags" placeholder="tag1, tag2" {...form.register('tags')} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t('tasks.triggerConfig')}</Label>
        <Textarea
          value={triggerText}
          onChange={(e) => {
            setTriggerText(e.target.value)
            setTriggerError('')
          }}
          className="font-mono text-xs"
          rows={3}
        />
        {triggerError !== '' && <p className="text-xs text-destructive">{triggerError}</p>}
      </div>

      {isPipelineMode ? (
        <div className="space-y-1.5">
          <Label>{t('tasks.payload')}</Label>
          <PipelineEditor
            value={pipelinePayload}
            onChange={setPipelinePayload}
            onValidityChange={setPipelineValid}
          />
        </div>
      ) : (
        <div className="space-y-1.5">
          <Label>{t('tasks.payload')}</Label>
          <Textarea
            value={payloadText}
            onChange={(e) => {
              setPayloadText(e.target.value)
              setPayloadError('')
            }}
            className="min-h-[160px] font-mono text-xs"
          />
          {payloadError !== '' && <p className="text-xs text-destructive">{payloadError}</p>}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <div className="flex gap-2">
          {isEdit && onDelete !== undefined && (
            <Button
              type="button"
              variant="outline"
              className="text-destructive hover:bg-destructive/10"
              onClick={onDelete}
            >
              {t('common.delete')}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isEdit && onTest !== undefined && (
            <Button type="button" variant="secondary" onClick={onTest} disabled={submitting}>
              {t('common.test')}
            </Button>
          )}
          <Button type="submit" disabled={saveDisabled}>
            {submitting ? t('common.loading') : t('common.save')}
          </Button>
        </div>
      </div>
    </form>
  )
}

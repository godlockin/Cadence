import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2, RefreshCw, RotateCw } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { EmptyState } from '@/components/composite/empty-state'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { CopyButton } from '@/components/composite/copy-button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  useCreateCredential,
  useCredentials,
  useDeleteCredential,
  useRefreshCredential,
  useRotateCredential,
} from '@/features/credentials/hooks'
import { errorMessage } from '@/lib/api'
import { formatTs } from '@/lib/utils'
import { useToast } from '@/components/ui/toast'

export const Route = createFileRoute('/credentials/')({ component: CredentialsPage })

const CreateCredentialSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.enum(['api-key', 'oauth2', 'basic', 'bearer', 'webhook-secret']),
  secret: z.string().min(1).max(8192),
  /* Optional: an empty input must stay undefined, not coerce to 0. */
  expiresInSeconds: z.preprocess(
    (v) => (v === '' || v === undefined ? undefined : v),
    z.coerce.number().int().min(60).max(31_536_000).optional(),
  ),
})
type CreateCredentialValues = z.infer<typeof CreateCredentialSchema>

const KINDS = ['api-key', 'oauth2', 'basic', 'bearer', 'webhook-secret'] as const

function CredentialsPage(): React.ReactNode {
  const { t } = useTranslation()
  const { toast } = useToast()
  const { credentials, isPending } = useCredentials()
  const createCredential = useCreateCredential()
  const deleteCredential = useDeleteCredential()
  const refreshCredential = useRefreshCredential()
  const rotateCredential = useRotateCredential()
  const [open, setOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null)

  const form = useForm<CreateCredentialValues>({
    resolver: zodResolver(CreateCredentialSchema),
    defaultValues: { name: '', kind: 'api-key', secret: '' },
  })

  const handleDelete = (id: string): void => {
    deleteCredential.mutate(id, {
      onSuccess: () => {
        toast({ title: t('credentials.deleted'), variant: 'success' })
        setDeleteTargetId(null)
      },
      onError: (e: unknown) => {
        toast({ title: errorMessage(e), variant: 'error' })
      },
    })
  }

  const onSubmit = async (values: CreateCredentialValues): Promise<void> => {
    setErrorMsg('')
    try {
      await createCredential.mutateAsync(values)
      form.reset()
      setOpen(false)
      toast({ title: t('credentials.created'), variant: 'success' })
    } catch (e: unknown) {
      setErrorMsg(errorMessage(e))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t('credentials.title')}
        description={`${credentials.length} ${t('common.total')}`}
      >
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4" /> {t('credentials.newCredential')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('credentials.newCredential')}</DialogTitle>
            </DialogHeader>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('common.name')}</Label>
                <Input id="name" {...form.register('name')} />
                {form.formState.errors.name !== undefined && (
                  <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label>{t('credentials.kind')}</Label>
                <Select
                  value={form.watch('kind')}
                  onValueChange={(v) => form.setValue('kind', v as CreateCredentialValues['kind'])}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {t(`credentials.kinds.${k}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="secret">{t('credentials.secret')}</Label>
                <Input id="secret" type="password" {...form.register('secret')} />
                {form.formState.errors.secret !== undefined && (
                  <p className="text-xs text-destructive">{form.formState.errors.secret.message}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="expiresInSeconds">{t('credentials.expiresInLabel')}</Label>
                <Input id="expiresInSeconds" type="number" {...form.register('expiresInSeconds')} />
              </div>
              {errorMsg !== '' && <p className="text-xs text-destructive">{errorMsg}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t('common.cancel')}
                </Button>
                <Button type="submit" disabled={createCredential.isPending}>
                  {createCredential.isPending ? t('common.loading') : t('common.create')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </PageHeader>

      {isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
        </div>
      ) : credentials.length === 0 ? (
        <EmptyState title={t('credentials.noCredentials')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {credentials.map((cred) => (
            <Card key={cred.id} className="transition-shadow hover:shadow-md">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div className="flex items-center gap-2 min-w-0">
                  <CardTitle className="truncate text-sm">{cred.name}</CardTitle>
                  <CopyButton value={cred.id} className="shrink-0" />
                </div>
                <Badge variant="outline">{cred.kind}</Badge>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{t('credentials.type')}</span>
                  <span className="font-mono text-xs">{cred.type}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">
                    {t('credentials.expiresAt')}
                  </span>
                  <span className="text-xs">{formatTs(cred.expiresAt)}</span>
                </div>
                <div className="flex items-center justify-between pt-2">
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => refreshCredential.mutate(cred.id)}
                      title={t('common.refresh')}
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => rotateCredential.mutate(cred.id)}
                      title={t('credentials.rotate')}
                    >
                      <RotateCw className="h-4 w-4" />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-destructive"
                    onClick={() => setDeleteTargetId(cred.id)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleteTargetId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTargetId(null)
        }}
        title={t('credentials.deleteTitle')}
        description={t('credentials.deleteDesc')}
        confirmLabel={t('common.delete')}
        variant="destructive"
        isPending={deleteCredential.isPending}
        onConfirm={() => {
          if (deleteTargetId !== null) handleDelete(deleteTargetId)
        }}
      />
    </div>
  )
}

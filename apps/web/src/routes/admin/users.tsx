import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Plus, UserPlus } from 'lucide-react'
import { PageHeader } from '@/components/composite/page-header'
import { EmptyState } from '@/components/composite/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useAddGroupMember,
  useGroups,
  useInviteUser,
  useUpdateUser,
  useUsers,
} from '@/features/admin/hooks'
import { errorMessage } from '@/lib/api'
import type { PublicUser } from '@/lib/types'

export const Route = createFileRoute('/admin/users')({ component: AdminUsersPage })

const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const

const InviteSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120),
  role: z.enum(ROLES).default('viewer'),
})
type InviteValues = z.infer<typeof InviteSchema>

function RoleCell({ user }: { user: PublicUser }): React.ReactNode {
  const updateUser = useUpdateUser()
  return (
    <Select
      value={user.role}
      onValueChange={(v) =>
        updateUser.mutate({ id: user.id, patch: { role: v as PublicUser['role'] } })
      }
    >
      <SelectTrigger className="h-8 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r}>
            {r}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function InviteUserDialog(): React.ReactNode {
  const { t } = useTranslation()
  const invite = useInviteUser()
  const [open, setOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const form = useForm<InviteValues>({
    resolver: zodResolver(InviteSchema),
    defaultValues: { email: '', password: '', displayName: '', role: 'viewer' },
  })

  const onSubmit = async (values: InviteValues): Promise<void> => {
    setErrorMsg('')
    try {
      await invite.mutateAsync(values)
      form.reset()
      setOpen(false)
    } catch (e: unknown) {
      setErrorMsg(errorMessage(e))
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4" /> {t('admin.inviteUser')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.inviteUser')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">{t('auth.email')}</Label>
            <Input id="email" type="email" {...form.register('email')} />
            {form.formState.errors.email !== undefined && (
              <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="displayName">{t('auth.displayName')}</Label>
            <Input id="displayName" {...form.register('displayName')} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t('auth.password')}</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            {form.formState.errors.password !== undefined && (
              <p className="text-xs text-destructive">{form.formState.errors.password.message}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>{t('admin.role')}</Label>
            <Select
              value={form.watch('role')}
              onValueChange={(v) => form.setValue('role', v as InviteValues['role'])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {errorMsg !== '' && <p className="text-xs text-destructive">{errorMsg}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function GroupMembership(): React.ReactNode {
  const { t } = useTranslation()
  const { groups, isPending } = useGroups()
  const { users } = useUsers()
  const addMember = useAddGroupMember()
  const [groupId, setGroupId] = useState('')
  const [userId, setUserId] = useState('')

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <UserPlus className="h-4 w-4 text-muted-foreground" />
        <p className="text-sm font-medium">{t('nav.admin')} — Groups</p>
      </div>
      {isPending ? (
        <Skeleton className="h-8" />
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('common.empty')}</p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {groups.map((g) => (
              <Badge key={g.id} variant="outline">
                {g.name}
              </Badge>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-40 text-xs">
                <SelectValue placeholder="Group" />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={userId} onValueChange={setUserId}>
              <SelectTrigger className="w-40 text-xs">
                <SelectValue placeholder="User" />
              </SelectTrigger>
              <SelectContent>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              disabled={groupId === '' || userId === '' || addMember.isPending}
              onClick={() => {
                if (groupId !== '' && userId !== '') addMember.mutate({ groupId, userId })
              }}
            >
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AdminUsersPage(): React.ReactNode {
  const { t } = useTranslation()
  const { users, isPending } = useUsers()

  return (
    <div className="space-y-4">
      <PageHeader title={t('admin.usersTitle')} description={`${users.length} total`}>
        <InviteUserDialog />
      </PageHeader>
      <div className="rounded-xl border border-border bg-card shadow-sm">
        {isPending ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="p-4">
            <EmptyState title={t('common.empty')} />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('auth.displayName')}</TableHead>
                <TableHead>{t('auth.email')}</TableHead>
                <TableHead>{t('admin.role')}</TableHead>
                <TableHead>{t('admin.isActive')}</TableHead>
                <TableHead>{t('admin.isSuperadmin')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.displayName}</TableCell>
                  <TableCell className="text-muted-foreground">{u.email}</TableCell>
                  <TableCell>
                    <RoleCell user={u} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.isActive ? 'success' : 'secondary'}>
                      {u.isActive ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {u.isSuperadmin ? <Badge variant="accent">Super</Badge> : '—'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <GroupMembership />
    </div>
  )
}

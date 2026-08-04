/**
 * Test factory: build a valid Task.
 */
import type { Task, TaskId, PayloadKind, TaskStatus, TriggerKind } from '@cadence/domain'
import { ulid } from 'ulid'

export interface TaskOverrides {
  id?: TaskId
  name?: string
  payload_kind?: PayloadKind
  payload_json?: string
  trigger_kind?: TriggerKind
  status?: TaskStatus
  cron?: string | null
  group_id?: TaskId | null
  owner_id?: TaskId
}

export function makeTask(overrides: TaskOverrides = {}): Task {
  const now = Date.now()
  return {
    id: (overrides.id ?? (ulid() as TaskId)) as TaskId,
    name: overrides.name ?? 'sample-task',
    description: '',
    owner_id: (overrides.owner_id ?? ('01J00000000000000000000000' as TaskId)) as TaskId,
    group_id: (overrides.group_id ?? null) as TaskId | null,
    payload_kind: overrides.payload_kind ?? 'http',
    payload_json: overrides.payload_json ?? JSON.stringify({ url: 'https://example.com' }),
    trigger_kind: overrides.trigger_kind ?? 'manual',
    trigger_config_json: '{}',
    status: overrides.status ?? 'pending',
    cron: overrides.cron ?? null,
    timezone: 'UTC',
    start_at: null,
    end_at: null,
    max_retries: 0,
    retry_backoff: 'exponential',
    concurrency_policy: 'skip',
    jitter_ms: 0,
    timeout_ms: 30_000,
    tags: [],
    notifications_json: null,
    metadata_json: '{}',
    version: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  }
}

/**
 * @cadence/scheduler — shared test helpers.
 */
import { ulid } from 'ulid'
import type { Task, TaskId } from '@cadence/domain'
import type { InMemoryStorageAdapter } from '@cadence/storage'

export function buildTask(overrides: Partial<Task> = {}): Task {
  const id = (overrides.id ?? ulid()) as TaskId
  const now = Date.now()
  const task: Task = {
    id,
    name: overrides.name ?? 'test-task',
    description: overrides.description,
    owner_id: overrides.owner_id ?? ulid(),
    group_id: overrides.group_id ?? null,
    payload_kind: overrides.payload_kind ?? 'http',
    payload_json: overrides.payload_json ?? '{"url":"http://example.invalid"}',
    trigger_kind: overrides.trigger_kind ?? 'manual',
    trigger_config_json: overrides.trigger_config_json ?? '{}',
    status: overrides.status ?? 'scheduled',
    cron: overrides.cron ?? null,
    timezone: overrides.timezone ?? 'UTC',
    start_at: overrides.start_at ?? null,
    end_at: overrides.end_at ?? null,
    max_retries: overrides.max_retries ?? 0,
    retry_backoff: overrides.retry_backoff ?? 'exponential',
    concurrency_policy: overrides.concurrency_policy ?? 'skip',
    jitter_ms: overrides.jitter_ms ?? 0,
    timeout_ms: overrides.timeout_ms ?? 30000,
    tags: overrides.tags ?? [],
    notifications_json: overrides.notifications_json ?? null,
    metadata_json: overrides.metadata_json ?? '{}',
    version: overrides.version ?? 1,
    created_at: overrides.created_at ?? now,
    updated_at: overrides.updated_at ?? now,
    deleted_at: overrides.deleted_at ?? null,
  }
  return task
}

export async function persistTask(
  storage: InMemoryStorageAdapter,
  task: Task,
): Promise<Task> {
  await storage.saveTask(task)
  return task
}

/**
 * PulseDeck seed script — demo accounts + sample data.
 *
 * Usage:
 *   pnpm seed
 *
 * Accounts created (password: test1234):
 *   admin@test.com     — super_admin
 *   operator@test.com  — operator
 *   viewer@test.com    — viewer
 *
 * The script is **idempotent** — re-running skips existing users.
 */

import { randomUUID } from 'node:crypto'
import { ulid } from 'ulid'
import { hashPassword } from '@cadence/auth'
import { openDevStorage } from './dev-shared.js'
import type { UserId, TaskId } from '@cadence/domain'

/* ─── demo accounts ─── */

const DEMO_USERS = [
  { email: 'admin@test.com',    displayName: 'Admin',    role: 'admin' as const,  isSuperadmin: true },
  { email: 'operator@test.com', displayName: 'Operator', role: 'editor' as const, isSuperadmin: false },
  { email: 'viewer@test.com',   displayName: 'Viewer',   role: 'viewer' as const, isSuperadmin: false },
] as const

const DEMO_PASSWORD = 'test1234'

/* ─── main ─── */

async function main() {
  const { storage, close } = openDevStorage()
  const now = Date.now()

  const created: string[] = []

  for (const u of DEMO_USERS) {
    const existing = await storage.getUserByEmail(u.email)
    if (existing !== null) {
      console.log(`[seed] skip existing: ${u.email}`)
      continue
    }

    const id = randomUUID() as UserId
    const pwHash = await hashPassword(DEMO_PASSWORD)
    await storage.saveUser({
      id,
      email: u.email,
      displayName: u.displayName,
      role: u.role,
      passwordHash: pwHash,
      isActive: true,
      isSuperadmin: u.isSuperadmin,
      createdAt: new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
    })

    console.log(`[seed] created ${u.role}: ${u.email} (id: ${id})`)
    created.push(u.email)
  }

  /* ─── sample demo tasks ─── */

  if (created.length > 0) {
    const admin = await storage.getUserByEmail('admin@test.com')
    if (admin) {
      const taskId = ulid() as TaskId

      // 1. HTTP health check task
      await storage.saveTask({
        id: taskId,
        name: 'Demo - HTTP Health Check',
        description: 'Checks httpbin.org/get every 5 minutes',
        owner_id: admin.id,
        group_id: null,
        payload_kind: 'http',
        payload_json: JSON.stringify({ url: 'https://httpbin.org/get', method: 'GET', timeoutMs: 10000 }),
        trigger_kind: 'cron',
        trigger_config_json: JSON.stringify({ cron: '*/5 * * * *', timezone: 'UTC' }),
        status: 'scheduled',
        cron: '*/5 * * * *',
        timezone: 'UTC',
        start_at: null,
        end_at: null,
        max_retries: 2,
        retry_backoff: 'exponential',
        concurrency_policy: 'skip',
        jitter_ms: 0,
        timeout_ms: 30000,
        tags: ['demo', 'health-check'],
        notifications_json: null,
        metadata_json: '{}',
        version: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      console.log(`[seed] created demo task "HTTP Health Check" (id: ${taskId})`)

      // 2. Manual pipeline task
      const pipelineId = ulid() as TaskId
      await storage.saveTask({
        id: pipelineId,
        name: 'Demo - Pipeline Example',
        description: 'A sample 6-node pipeline',
        owner_id: admin.id,
        group_id: null,
        payload_kind: 'pipeline',
        payload_json: JSON.stringify({
          nodes: [
            { slot: 'input',          type: 'http',   config: { url: 'https://httpbin.org/json' } },
            { slot: 'validate',       type: 'zod',    config: { schema: '{}' } },
            { slot: 'process',        type: 'transform', config: { engine: 'jsonata', expr: 'slideshow.title' } },
            { slot: 'resultValidate', type: 'http',   config: {} },
            { slot: 'postProcess',    type: 'log',    config: {} },
            { slot: 'output',         type: 'webhook',  config: { url: 'https://httpbin.org/post' } },
          ],
        }),
        trigger_kind: 'manual',
        trigger_config_json: JSON.stringify({}),
        status: 'pending',
        cron: null,
        timezone: 'UTC',
        start_at: null,
        end_at: null,
        max_retries: 1,
        retry_backoff: 'fixed',
        concurrency_policy: 'skip',
        jitter_ms: 0,
        timeout_ms: 60000,
        tags: ['demo', 'pipeline'],
        notifications_json: null,
        metadata_json: '{}',
        version: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      console.log(`[seed] created demo task "Pipeline Example" (id: ${pipelineId})`)

      // 3. Webhook ingress task
      const webhookId = ulid() as TaskId
      await storage.saveTask({
        id: webhookId,
        name: 'Demo - Webhook Ingress',
        description: 'Receives external webhook calls and forwards to Slack',
        owner_id: admin.id,
        group_id: null,
        payload_kind: 'webhook',
        payload_json: JSON.stringify({ path: '/api/webhooks/demo-wh/trigger' }),
        trigger_kind: 'webhook',
        trigger_config_json: JSON.stringify({ token: 'demo-wh' }),
        status: 'scheduled',
        cron: null,
        timezone: 'UTC',
        start_at: null,
        end_at: null,
        max_retries: 0,
        retry_backoff: 'fixed',
        concurrency_policy: 'parallel',
        jitter_ms: 0,
        timeout_ms: 10000,
        tags: ['demo', 'webhook'],
        notifications_json: JSON.stringify({ onFailure: 'log' }),
        metadata_json: '{}',
        version: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      })
      console.log(`[seed] created demo task "Webhook Ingress" (id: ${webhookId})`)
    }
  }

  await close()
  console.log(`\n[seed] Done — ${created.length} new accounts, password: "${DEMO_PASSWORD}"`)
  console.log('[seed] Start: pnpm dev → http://localhost:5173')
}

main().catch((err) => {
  console.error('[seed] FAILED:', err)
  process.exit(1)
})

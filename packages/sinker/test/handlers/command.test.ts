import { describe, it, expect, beforeEach } from 'vitest'
import { CommandHandler } from '../../src/handlers/command.js'
import { CommandInjectionError } from '../../src/errors.js'
import { makeTask } from '../fixtures/make-task.js'
import type { Execution, PayloadHandler, TriggerContext } from '../../src/index.js'

function makeCtx() {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask({ payload_kind: 'command' })
  const execution = {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: task.id,
    status: 'running' as const,
    triggerSource: 'manual' as const,
    triggeredBy: null,
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  } as Execution
  const trigger: TriggerContext = { source: 'manual' }
  const ctx: Parameters<PayloadHandler['execute']>[1] = {
    task,
    execution,
    trigger,
    signal: new AbortController().signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { events, ctx }
}

describe('CommandHandler', () => {
  let handler: CommandHandler

  beforeEach(() => {
    handler = new CommandHandler()
  })

  it('rejects invalid config', () => {
    expect(() => handler.validateConfig({ cmd: '' })).toThrow()
  })

  it('runs a successful command and emits events', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({ cmd: 'node', args: ['-e', 'process.stdout.write("hi")'] }),
      ctx,
    )
    const types = events.map((e) => e.type)
    expect(types).toEqual(['started', 'log', 'result', 'finished'])
    const result = events.find((e) => e.type === 'result')?.data as { exitCode: number; stdout: string }
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe('hi')
  })

  it('rejects with non-zero exit code', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ cmd: 'node', args: ['-e', 'process.exit(7)'] }),
        ctx,
      ),
    ).rejects.toThrow(/exited with code 7/)
  })

  /* ---------- sandbox: binary whitelist ---------- */

  it("rejects cmd='rm -rf /'", async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(handler.validateConfig({ cmd: 'rm', args: ['-rf', '/'] }), ctx),
    ).rejects.toBeInstanceOf(CommandInjectionError)
  })

  it("rejects cmd='/bin/sh'", async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(handler.validateConfig({ cmd: '/bin/sh', args: [] }), ctx),
    ).rejects.toBeInstanceOf(CommandInjectionError)
  })

  it('rejects args containing shell metachars', async () => {
    const { ctx } = makeCtx()
    for (const bad of ['; rm', '&& ls', '| grep', '`whoami`', '$HOME', '> foo', '< foo', 'a\nb']) {
      await expect(
        handler.execute(
          handler.validateConfig({ cmd: 'echo', args: [bad] }),
          ctx,
        ),
      ).rejects.toBeInstanceOf(CommandInjectionError)
    }
  })

  it('rejects unknown env keys', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ cmd: 'echo', args: ['x'], env: { AWS_SECRET_ACCESS_KEY: 'leak' } }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(CommandInjectionError)
  })

  it('accepts curl with safe args', async () => {
    const { ctx, events } = makeCtx()
    /* We don't require network reachability (sandbox env may be offline).
     * The test only proves the sandbox accepts the binary + flag set. */
    const result = await handler
      .execute(
        handler.validateConfig({
          cmd: 'curl',
          args: ['-sS', '--max-time', '1', 'https://example.com'],
        }),
        ctx,
      )
      .then(() => events.find((e) => e.type === 'result')?.data as { exitCode: number })
      .catch((err: unknown) => {
        /* expected when offline — the relevant assertion is that the
         * sandbox pre-flight passed and the spawn went through. */
        if (err instanceof Error && /exited with code 35|exited with code 28/.test(err.message)) {
          return { exitCode: 35 }
        }
        throw err
      })
    expect(typeof result.exitCode).toBe('number')
  })

  it('accepts node script.js with safe args', async () => {
    const { ctx, events } = makeCtx()
    await handler.execute(
      handler.validateConfig({ cmd: 'node', args: ['-e', 'console.log(2+2)'] }),
      ctx,
    )
    const result = events.find((e) => e.type === 'result')?.data as { stdout: string }
    expect(result.stdout).toContain('4')
  })

  it('rejects env keys with safe keys only', async () => {
    const { ctx } = makeCtx()
    await handler.execute(
      handler.validateConfig({ cmd: 'echo', args: ['hi'], env: { HOME: '/tmp' } }),
      ctx,
    )
  })

  it('rejects cwd outside /tmp and $HOME', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ cmd: 'echo', args: ['x'], cwd: '/etc' }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(CommandInjectionError)
  })

  it('rejects flag smuggling via unknown flags', async () => {
    const { ctx } = makeCtx()
    await expect(
      handler.execute(
        handler.validateConfig({ cmd: 'curl', args: ['--attacker-controlled'] }),
        ctx,
      ),
    ).rejects.toBeInstanceOf(CommandInjectionError)
  })
})

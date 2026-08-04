/**
 * @cadence/sinker — Command handler.
 *
 * Spawns a local subprocess inside a hardened sandbox:
 *   - `cmd` MUST appear in the binary whitelist.
 *   - args are tokenised; any shell metachar is rejected.
 *   - env keys are whitelisted (PATH, HOME, LANG, …).
 *   - cwd is restricted to /tmp or $HOME.
 *   - timeout is capped at MAX_COMMAND_TIMEOUT_MS.
 *   - stdout/stderr are bounded to MAX_OUTPUT_BYTES to avoid OOM.
 *
 * Throws NodeOnlyError on Cloudflare. Throws CommandInjectionError on
 * any sandbox violation BEFORE the subprocess is spawned.
 */
import { spawn } from 'node:child_process'
import type { PayloadHandler } from '../types.js'
import { detectRuntime, NodeOnlyError, ERROR_CODES } from '../env.js'
import {
  assertCommandSafe,
  CommandSecurityConfigSchema,
  MAX_COMMAND_TIMEOUT_MS,
  type CommandSecurityConfig,
} from '../security.js'
import { CommandInjectionError } from '../errors.js'

const CommandConfigSchema = CommandSecurityConfigSchema
export type CommandConfig = CommandSecurityConfig

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MB

export class CommandHandler implements PayloadHandler<CommandConfig> {
  readonly kind = 'command' as const

  validateConfig(raw: unknown): CommandConfig {
    return CommandConfigSchema.parse(raw)
  }

  async execute(
    config: CommandConfig,
    ctx: Parameters<PayloadHandler['execute']>[1],
  ): Promise<void> {
    if (detectRuntime() === 'cloudflare') {
      ctx.emit({
        type: 'error',
        ts: Date.now(),
        data: { code: ERROR_CODES.NODE_UNSUPPORTED_IN_RUNTIME, message: 'spawn unavailable on CF' },
      })
      throw new NodeOnlyError('child_process.spawn')
    }

    /* Hardened pre-flight: binary, args, env, cwd. Throws typed error. */
    assertCommandSafe(config)

    const timeoutMs = Math.min(Math.max(config.timeoutMs, 100), MAX_COMMAND_TIMEOUT_MS)
    const child = spawn(config.cmd, config.args, {
      cwd: config.cwd,
      env: {
        ...pickSafeEnv(process.env),
        ...Object.fromEntries(
          Object.entries(config.env).filter(([k]) =>
            // safety net — assertCommandSafe already filtered, but keep
            // the runtime guard close to spawn() to avoid regressions.
            SAFE_ENV_KEYS_FORWARD.has(k),
          ),
        ),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    ctx.emit({ type: 'started', ts: Date.now(), data: { cmd: config.cmd } })

    const abortChild = () => {
      if (!child.killed) child.kill('SIGTERM')
    }
    ctx.signal.addEventListener('abort', abortChild, { once: true })

    const timer = setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, timeoutMs)

    const stdoutChunks: string[] = []
    const stderrChunks: string[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let truncated = false

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length
      if (stdoutBytes > MAX_OUTPUT_BYTES) {
        if (!truncated) {
          truncated = true
          if (!child.killed) child.kill('SIGKILL')
        }
        return
      }
      const s = chunk.toString('utf8')
      stdoutChunks.push(s)
      ctx.emit({ type: 'log', ts: Date.now(), data: { stream: 'stdout', text: s } })
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length
      if (stderrBytes > MAX_OUTPUT_BYTES) {
        if (!truncated) {
          truncated = true
          if (!child.killed) child.kill('SIGKILL')
        }
        return
      }
      const s = chunk.toString('utf8')
      stderrChunks.push(s)
      ctx.emit({ type: 'log', ts: Date.now(), data: { stream: 'stderr', text: s } })
    })

    try {
      const exitCode: number = await new Promise((resolve, reject) => {
        child.once('error', reject)
        child.once('close', (code) => resolve(code ?? -1))
      })
      ctx.emit({
        type: 'result',
        ts: Date.now(),
        data: {
          exitCode,
          stdout: stdoutChunks.join(''),
          stderr: stderrChunks.join(''),
          truncated,
        },
      })
      if (exitCode !== 0) {
        throw new Error(`Command '${config.cmd}' exited with code ${exitCode}`)
      }
      if (truncated) {
        /* Even on a 0 exit, we must flag the run as truncated. */
        throw new CommandInjectionError('command', `output exceeded ${MAX_OUTPUT_BYTES} bytes`)
      }
    } finally {
      clearTimeout(timer)
      ctx.signal.removeEventListener('abort', abortChild)
      ctx.emit({ type: 'finished', ts: Date.now() })
    }
  }
}

const SAFE_ENV_KEYS_FORWARD: ReadonlySet<string> = new Set([
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'TZ',
  'USER',
  'LOGNAME',
  'TMPDIR',
  'SHELL',
])

function pickSafeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) continue
    if (!SAFE_ENV_KEYS_FORWARD.has(k)) continue
    out[k] = v
  }
  return out
}

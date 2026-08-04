/**
 * @cadence/nodes — hardened subprocess runner (ported from sinker command.ts).
 *
 * Spawns a local subprocess inside the whitelist sandbox:
 *   - `cmd` MUST appear in the binary whitelist,
 *   - args are tokenised; shell metachars rejected,
 *   - env keys whitelisted, cwd restricted to /tmp or $HOME,
 *   - timeout capped at MAX_COMMAND_TIMEOUT_MS,
 *   - stdout/stderr bounded to MAX_OUTPUT_BYTES.
 */
import { spawn } from 'node:child_process'
import type { NodeContext } from '../types.js'
import { emitLog, emitResult } from './context.js'
import {
  assertCommandSafe,
  CommandSecurityConfigSchema,
  MAX_COMMAND_TIMEOUT_MS,
  type CommandSecurityConfig,
} from './security.js'

export const CommandRunConfigSchema = CommandSecurityConfigSchema
export type CommandRunConfig = CommandSecurityConfig

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024 // 10 MB

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

export interface CommandRunResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
  readonly truncated: boolean
}

/** Run a hardened command, streaming stdout/stderr as `log` events. */
export function runCommand(config: CommandRunConfig, ctx: NodeContext): Promise<CommandRunResult> {
  /* Hardened pre-flight: binary, args, env, cwd. Throws typed error. */
  assertCommandSafe(config)

  const timeoutMs = Math.min(Math.max(config.timeoutMs, 100), MAX_COMMAND_TIMEOUT_MS)
  const child = spawn(config.cmd, config.args, {
    cwd: config.cwd,
    env: {
      ...pickSafeEnv(process.env),
      ...Object.fromEntries(
        Object.entries(config.env).filter(([k]) => SAFE_ENV_KEYS_FORWARD.has(k)),
      ),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

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
    emitLog(ctx, s, 'stdout')
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
    emitLog(ctx, s, 'stderr')
  })

  const cleanup = () => {
    clearTimeout(timer)
    ctx.signal.removeEventListener('abort', abortChild)
  }

  return new Promise((resolve, reject) => {
    child.once('error', (causeValue) => {
      cleanup()
      reject(causeValue)
    })
    child.once('close', (code) => {
      cleanup()
      const result: CommandRunResult = {
        exitCode: code ?? -1,
        stdout: stdoutChunks.join(''),
        stderr: stderrChunks.join(''),
        truncated,
      }
      emitResult(ctx, result)
      resolve(result)
    })
  })
}

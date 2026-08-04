/**
 * @cadence/sinker — structured JSON logger.
 * No console.log. Every line is a single JSON object with stable schema:
 *   { ts, level, scope, event, ...data }
 */
import type { LogLevel, Logger } from './types.js'

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function stdout() {
  return typeof process !== 'undefined' && process.stdout ? process.stdout : undefined
}

function emit(level: LogLevel, scope: string, event: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope,
    event,
    ...(data ?? {}),
  })
  const out = stdout()
  if (out) {
    if (level === 'error') out.write(line + '\n')
    else if (level === 'warn') out.write(line + '\n')
    else out.write(line + '\n')
  }
}

export interface LoggerOptions {
  readonly scope?: string
  readonly minLevel?: LogLevel
}

export class JsonLogger implements Logger {
  private readonly scope: string
  private readonly minLevel: LogLevel

  constructor(opts: LoggerOptions = {}) {
    this.scope = opts.scope ?? 'sinker'
    this.minLevel = opts.minLevel ?? 'info'
  }

  private log(level: LogLevel, event: string, data?: Record<string, unknown>) {
    if (LEVEL_RANK[level] < LEVEL_RANK[this.minLevel]) return
    emit(level, this.scope, event, data)
  }

  debug(event: string, data?: Record<string, unknown>) {
    this.log('debug', event, data)
  }
  info(event: string, data?: Record<string, unknown>) {
    this.log('info', event, data)
  }
  warn(event: string, data?: Record<string, unknown>) {
    this.log('warn', event, data)
  }
  error(event: string, data?: Record<string, unknown>) {
    this.log('error', event, data)
  }

  child(scope: string): Logger {
    return new JsonLogger({ scope: `${this.scope}.${scope}`, minLevel: this.minLevel })
  }
}

export const SILENT_LOGGER: Logger = new JsonLogger({ minLevel: 'error' })

/* Tests want to capture structured output without writing to stdout. */
export class BufferedLogger implements Logger {
  readonly records: {
    level: LogLevel
    scope: string
    event: string
    data?: Record<string, unknown>
  }[] = []
  constructor(private readonly scope = 'test') {}
  debug(event: string, data?: Record<string, unknown>) {
    this.records.push({ level: 'debug', scope: this.scope, event, data })
  }
  info(event: string, data?: Record<string, unknown>) {
    this.records.push({ level: 'info', scope: this.scope, event, data })
  }
  warn(event: string, data?: Record<string, unknown>) {
    this.records.push({ level: 'warn', scope: this.scope, event, data })
  }
  error(event: string, data?: Record<string, unknown>) {
    this.records.push({ level: 'error', scope: this.scope, event, data })
  }
  child(scope: string): Logger {
    const child = new BufferedLogger(`${this.scope}.${scope}`)
    // share buffer so tests see both
    const orig = child.records
    const push = orig.push.bind(orig)
    orig.push = (record) => {
      this.records.push(record)
      return push(record)
    }
    return child
  }
}

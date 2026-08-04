/**
 * @cadence/auth — minimal structured logger interface.
 *
 * The credential-refresh engine logs structured events (refresh started,
 * succeeded, failed, disabled) rather than ad-hoc console noise, so
 * operators can route them to a central sink.
 */

export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  debug?(message: string, meta?: Record<string, unknown>): void
}

/** Discard-everything logger — default for tests / embedded usage. */
export const noopLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
}

/** Simple console logger (Node). Structured single-line output. */
export function createConsoleLogger(name: string): Logger {
  const emit = (level: string, message: string, meta?: Record<string, unknown>): void => {
    const line = JSON.stringify({
      level,
      logger: name,
      message,
      ...(meta ?? {}),
      ts: Date.now(),
    })
    if (level === 'error') console.error(line)
    else if (level === 'warn') console.warn(line)
    else console.info(line)
  }
  return {
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    debug: (m, meta) => emit('debug', m, meta),
  }
}

/**
 * @cadence/sinker — PayloadDispatcher.
 *
 * Resolves a Task's `payload_kind` to a registered handler, validates the
 * payload JSON, and runs the handler. Failures are surfaced as structured
 * events so the worker can persist them in the Execution row.
 */
import type { Execution, PayloadKind, Task } from '@cadence/domain'
import type { ExecutorContext, PayloadHandler, Logger } from './types.js'
import { HandlerNotFoundError, PayloadValidationError } from './types.js'

export interface DispatcherOptions {
  readonly logger: Logger
}

export class PayloadDispatcher {
  private readonly handlers = new Map<PayloadKind, PayloadHandler<unknown>>()
  private readonly logger: Logger

  constructor(opts: DispatcherOptions) {
    this.logger = opts.logger.child('dispatcher')
  }

  register<TConfig>(handler: PayloadHandler<TConfig>): this {
    this.handlers.set(handler.kind, handler as unknown as PayloadHandler<unknown>)
    this.logger.debug('handler.registered', { kind: handler.kind })
    return this
  }

  has(kind: PayloadKind): boolean {
    return this.handlers.has(kind)
  }

  kinds(): readonly PayloadKind[] {
    return [...this.handlers.keys()]
  }

  /**
   * Parse the task's payload_json, validate it, and run the handler.
   * Throws HandlerNotFoundError or PayloadValidationError on bad input.
   */
  async dispatch(
    task: Task,
    execution: Execution,
    trigger: ExecutorContext['trigger'],
    signal: AbortSignal,
  ): Promise<void> {
    const handler = this.handlers.get(task.payload_kind)
    if (!handler) {
      throw new HandlerNotFoundError(task.payload_kind)
    }

    let raw: unknown
    try {
      raw = JSON.parse(task.payload_json) as unknown
    } catch (causeValue) {
      throw new PayloadValidationError(task.payload_kind, causeValue)
    }

    let config: unknown
    try {
      config = handler.validateConfig(raw)
    } catch (causeValue) {
      throw new PayloadValidationError(task.payload_kind, causeValue)
    }

    const ctx: ExecutorContext = {
      task,
      execution,
      trigger,
      signal,
      emit: (event) => this.logger.debug('dispatch.event', { kind: task.payload_kind, event }),
    }

    this.logger.info('handler.run', {
      taskId: task.id,
      executionId: execution.id,
      kind: task.payload_kind,
    })

    await handler.execute(config, ctx)
  }
}

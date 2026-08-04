/**
 * @cadence/sinker — public surface.
 * Aggregates task lifecycle, queue dispatch, and executor delegation.
 */
import type { Task, TaskId, ExecutionId } from '@cadence/domain'

/* Re-export domain types we accept. */
export type { Task, TaskId, ExecutionId }

export * from './types.js'
export {
  nextState,
  isTerminal,
  legalEventsFrom,
  TRANSITIONS,
  TASK_EVENTS,
} from './state-machine.js'
export type { TaskEvent } from './state-machine.js'
export { PayloadDispatcher } from './dispatcher.js'
export {
  SinkerEngine,
  type SinkerDeps,
  type Runtime,
  type EngineStatus,
  type TriggerOptions,
} from './engine.js'
export { JsonLogger, BufferedLogger, SILENT_LOGGER } from './logger.js'
export { HttpHandler } from './handlers/http.js'
export { CommandHandler } from './handlers/command.js'
export { ScriptHandler } from './handlers/script.js'
export { PipelineHandler, describePipelineKind } from './handlers/pipeline.js'
export { WebhookHandler } from './handlers/webhook.js'
export { detectRuntime, NodeOnlyError, ERROR_CODES } from './env.js'
export {
  ForbiddenError,
  SSRFError,
  CommandInjectionError,
  ScriptSandboxError,
  SECURITY_ERROR_CODES,
} from './errors.js'

export const SINKER_VERSION = '0.1.0'

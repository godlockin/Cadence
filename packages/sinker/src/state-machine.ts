/**
 * @cadence/sinker — finite state machine for Task lifecycle.
 *
 * 9 states (matches domain TaskStatus):
 *   pending, scheduled, queued, dispatched, running,
 *   success, failed, cancelled, suspended
 *
 * The machine is pure: it never touches IO, it only validates transitions.
 * Callers (the engine, the worker loop) commit the transition by writing
 * it back through the storage adapter.
 */
import type { TaskStatus } from '@cadence/domain'
import { StateTransitionError } from './types.js'

/* All events that can move a task between states. */
export const TASK_EVENTS = [
  'register', // create / patch -> pending or scheduled
  'enable', // pending -> scheduled
  'disable', // scheduled -> pending
  'enqueue', // scheduled/suspended -> queued
  'dispatch', // queued -> dispatched
  'start', // dispatched -> running
  'succeed', // running -> success
  'fail', // running -> failed
  'cancel', // running/queued/dispatched -> cancelled
  'suspend', // scheduled/pending -> suspended
  'resume', // suspended -> scheduled
  'retry', // failed -> queued (worker re-enqueues)
  'expire', // scheduled -> disabled? kept as pending for clarity
] as const
export type TaskEvent = (typeof TASK_EVENTS)[number]

/* Terminal states accept no further events. failed is retryable so it is NOT terminal. */
const TERMINAL: ReadonlySet<TaskStatus> = new Set(['success', 'cancelled'])

/**
 * Adjacency table: from-state -> event -> to-state.
 * The 'from' state MUST be present; the 'to' state is the resolved state.
 * If a state has no row for an event, that event is illegal.
 */
type Transition = Readonly<Record<TaskEvent, TaskStatus>>
type TransitionMap = Readonly<Record<TaskStatus, Partial<Transition>>>

const EMPTY: Partial<Transition> = Object.freeze({})

export const TRANSITIONS: TransitionMap = Object.freeze({
  /* Initial state. Can be enabled to scheduled, or directly suspended. */
  pending: Object.freeze({
    enable: 'scheduled',
    enqueue: 'queued', // manual trigger on a pending task
    suspend: 'suspended',
    cancel: 'cancelled',
  }),

  /* Cron-scheduled or armed. */
  scheduled: Object.freeze({
    disable: 'pending',
    enqueue: 'queued',
    suspend: 'suspended',
    cancel: 'cancelled',
  }),

  /* Enqueued in the queue adapter, waiting for a worker. */
  queued: Object.freeze({
    dispatch: 'dispatched',
    cancel: 'cancelled',
  }),

  /* Picked up by a worker, about to be executed. */
  dispatched: Object.freeze({
    start: 'running',
    cancel: 'cancelled',
  }),

  /* Handler is executing. */
  running: Object.freeze({
    succeed: 'success',
    fail: 'failed',
    cancel: 'cancelled',
  }),

  /* Terminal. */
  success: EMPTY,
  failed: Object.freeze({
    retry: 'queued',
  }),
  cancelled: EMPTY,

  /* Held in place. Resume re-arms the schedule. */
  suspended: Object.freeze({
    resume: 'scheduled',
    enqueue: 'queued', // manual trigger while suspended
    cancel: 'cancelled',
  }),
}) as TransitionMap

export function isTerminal(state: TaskStatus): boolean {
  return TERMINAL.has(state)
}

export function nextState(from: TaskStatus, event: TaskEvent): TaskStatus {
  const row = TRANSITIONS[from]
  const target = row[event]
  if (!target) {
    throw new StateTransitionError(from, event)
  }
  return target
}

/**
 * Returns the legal events from a given state. Useful for introspection,
 * tests, and emitting typed UIs.
 */
export function legalEventsFrom(state: TaskStatus): readonly TaskEvent[] {
  return Object.keys(TRANSITIONS[state] ?? EMPTY) as TaskEvent[]
}

import { describe, it, expect } from 'vitest'
import { TRANSITIONS, isTerminal, legalEventsFrom, nextState } from '../src/state-machine.js'
import { StateTransitionError } from '../src/types.js'
import type { TaskStatus } from '@cadence/domain'

const STATES: readonly TaskStatus[] = [
  'pending',
  'scheduled',
  'queued',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
  'suspended',
]

describe('state-machine: legal transitions', () => {
  const cases: ReadonlyArray<readonly [TaskStatus, Parameters<typeof nextState>[1], TaskStatus]> = [
    /* pending */
    ['pending', 'enable', 'scheduled'],
    ['pending', 'enqueue', 'queued'],
    ['pending', 'suspend', 'suspended'],
    ['pending', 'cancel', 'cancelled'],
    /* scheduled */
    ['scheduled', 'disable', 'pending'],
    ['scheduled', 'enqueue', 'queued'],
    ['scheduled', 'suspend', 'suspended'],
    ['scheduled', 'cancel', 'cancelled'],
    /* queued */
    ['queued', 'dispatch', 'dispatched'],
    ['queued', 'cancel', 'cancelled'],
    /* dispatched */
    ['dispatched', 'start', 'running'],
    ['dispatched', 'cancel', 'cancelled'],
    /* running */
    ['running', 'succeed', 'success'],
    ['running', 'fail', 'failed'],
    ['running', 'cancel', 'cancelled'],
    /* failed (terminal but retryable) */
    ['failed', 'retry', 'queued'],
    /* suspended */
    ['suspended', 'resume', 'scheduled'],
    ['suspended', 'enqueue', 'queued'],
    ['suspended', 'cancel', 'cancelled'],
  ]

  for (const [from, event, to] of cases) {
    it(`${from} --${event}--> ${to}`, () => {
      expect(nextState(from, event)).toBe(to)
    })
  }
})

describe('state-machine: terminal states are frozen', () => {
  it('success is terminal', () => {
    expect(isTerminal('success')).toBe(true)
    expect(legalEventsFrom('success')).toEqual([])
  })
  it('cancelled is terminal', () => {
    expect(isTerminal('cancelled')).toBe(true)
    expect(legalEventsFrom('cancelled')).toEqual([])
  })
  it('failed is terminal-ish (only retry)', () => {
    expect(isTerminal('failed')).toBe(false)
    expect(legalEventsFrom('failed')).toEqual(['retry'])
  })
})

describe('state-machine: illegal transitions throw', () => {
  it('running cannot be suspended', () => {
    expect(() => nextState('running', 'suspend')).toThrow(StateTransitionError)
  })
  it('success cannot be cancelled', () => {
    expect(() => nextState('success', 'cancel')).toThrow(StateTransitionError)
  })
  it('pending cannot start running', () => {
    expect(() => nextState('pending', 'start')).toThrow(StateTransitionError)
  })
  it('scheduled cannot be succeeded directly', () => {
    expect(() => nextState('scheduled', 'succeed')).toThrow(StateTransitionError)
  })
  it('queued cannot resume', () => {
    expect(() => nextState('queued', 'resume')).toThrow(StateTransitionError)
  })
})

describe('state-machine: transition table covers all 9 states', () => {
  it('every state has a row in the table', () => {
    for (const s of STATES) {
      expect(TRANSITIONS[s]).toBeDefined()
    }
  })
})

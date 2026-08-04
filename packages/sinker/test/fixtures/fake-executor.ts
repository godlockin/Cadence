/**
 * Fake executor adapter for unit tests. Delegates to a per-payload-kind
 * script supplied by the test, or to the real dispatcher.
 */
import type { Execution, ExecutorAdapter, Task, TriggerContext } from '@cadence/sinker'

export type ExecutorScript = (
  task: Task,
  execution: Execution,
  trigger: TriggerContext,
  signal: AbortSignal,
) => Promise<void>

export class FakeExecutor implements ExecutorAdapter {
  constructor(private readonly script: ExecutorScript = defaultScript) {}
  async execute(
    task: Task,
    execution: Execution,
    trigger: TriggerContext,
    signal: AbortSignal,
  ): Promise<void> {
    return this.script(task, execution, trigger, signal)
  }
}

export const defaultScript: ExecutorScript = async (_task, _exec, _trigger, signal) => {
  /* sleep ~5ms so the worker observes the running state */
  await new Promise<void>((resolve) => {
    const id = setTimeout(resolve, 5)
    signal.addEventListener('abort', () => clearTimeout(id), { once: true })
  })
}

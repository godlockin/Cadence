/**
 * Fake scheduler adapter for unit tests. Tracks which tasks are scheduled.
 */
import type { SchedulerAdapter } from '@cadence/sinker'
import type { Task, TaskId } from '@cadence/domain'

export class FakeScheduler implements SchedulerAdapter {
  private readonly scheduled = new Set<TaskId>()

  async reschedule(task: Task): Promise<void> {
    this.scheduled.add(task.id)
  }
  async unschedule(taskId: TaskId): Promise<void> {
    this.scheduled.delete(taskId)
  }
  async hasSchedule(taskId: TaskId): Promise<boolean> {
    return this.scheduled.has(taskId)
  }

  isScheduled(taskId: TaskId): boolean {
    return this.scheduled.has(taskId)
  }
}

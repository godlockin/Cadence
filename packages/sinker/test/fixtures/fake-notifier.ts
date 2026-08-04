/**
 * Fake notifier adapter for unit tests. Captures notifications.
 */
import type { NotifierAdapter, NotifyPayload } from '@cadence/sinker'

export class FakeNotifier implements NotifierAdapter {
  readonly sent: NotifyPayload[] = []
  async notify(payload: NotifyPayload): Promise<void> {
    this.sent.push(payload)
  }
}

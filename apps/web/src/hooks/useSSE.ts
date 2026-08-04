import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuthStore } from '@/lib/store'
import { SSEEventSchema, type SSEEvent } from '@/lib/types'
import type { SSEConnectionStatus } from '@/components/composite/sse-status-indicator'

/**
 * Subscribe to an execution's SSE stream.
 *
 * Uses fetch-based streaming (not EventSource) because the backend requires
 * a `Bearer` token in the Authorization header, which EventSource cannot send.
 * The stream is parsed line-by-line (`data: ...`) and auto-reconnects with a
 * small backoff unless the stream reached a terminal execution state.
 *
 * Returns { events, connectionStatus } where connectionStatus tracks live state.
 */
export function useSSE(executionId: string | null): {
  events: SSEEvent[]
  connectionStatus: SSEConnectionStatus
} {
  const [events, setEvents] = useState<SSEEvent[]>([])
  const [connectionStatus, setConnectionStatus] = useState<SSEConnectionStatus>('disconnected')
  const eventsRef = useRef<SSEEvent[]>([])
  const reconnectRef = useRef<number>(0)
  const cancelledRef = useRef<boolean>(false)

  const append = useCallback((event: SSEEvent) => {
    eventsRef.current = [...eventsRef.current, event]
    setEvents(eventsRef.current)
  }, [])

  useEffect(() => {
    if (executionId === null) {
      setEvents([])
      eventsRef.current = []
      setConnectionStatus('disconnected')
      return
    }
    cancelledRef.current = false
    let closed = false
    let abortController: AbortController | null = null
    let retryTimer: number | null = null

    const terminalStatuses = new Set(['success', 'failed', 'cancelled'])

    async function connect(): Promise<void> {
      const token = useAuthStore.getState().accessToken
      abortController = new AbortController()
      try {
        const res = await fetch(`/api/executions/${executionId}/stream`, {
          headers: token !== null ? { Authorization: `Bearer ${token}` } : undefined,
          signal: abortController.signal,
        })
        if (!res.ok || res.body === null) {
          setConnectionStatus('reconnecting')
          scheduleReconnect()
          return
        }
        reconnectRef.current = 0
        setConnectionStatus('connected')
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!closed) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          let newlineIndex = buffer.indexOf('\n')
          while (newlineIndex >= 0) {
            const line = buffer.slice(0, newlineIndex).trim()
            buffer = buffer.slice(newlineIndex + 1)
            if (line.startsWith('data:')) {
              const payload = line.slice(5).trim()
              if (payload.length === 0) {
                newlineIndex = buffer.indexOf('\n')
                continue
              }
              try {
                const parsed: unknown = JSON.parse(payload)
                const event = SSEEventSchema.parse(parsed)
                append(event)
                if (event.type === 'snapshot' && terminalStatuses.has(event.execution.status)) {
                  closed = true
                }
              } catch {
                /* ignore malformed frames */
              }
            }
            newlineIndex = buffer.indexOf('\n')
          }
        }
      } catch (err: unknown) {
        if (!closed && !cancelledRef.current) {
          setConnectionStatus('reconnecting')
          scheduleReconnect()
        }
        void err
      } finally {
        if (closed && !cancelledRef.current) {
          setConnectionStatus('disconnected')
        }
      }
    }

    function scheduleReconnect(): void {
      if (closed || cancelledRef.current) return
      const delay = Math.min(1000 * 2 ** reconnectRef.current, 15_000)
      reconnectRef.current += 1
      retryTimer = window.setTimeout(() => {
        void connect()
      }, delay)
    }

    setConnectionStatus('reconnecting')
    void connect()

    return () => {
      closed = true
      cancelledRef.current = true
      abortController?.abort()
      if (retryTimer !== null) window.clearTimeout(retryTimer)
      setConnectionStatus('disconnected')
    }
  }, [executionId, append])

  return { events, connectionStatus }
}

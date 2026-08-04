/**
 * @cadence/nodes — LLM HTTP helpers for `llm-text` / `llm-vision`.
 *
 * Talks to any OpenAI-compatible `/chat/completions` endpoint. The endpoint
 * is configurable so self-hosted gateways (vLLM, llama.cpp, Ollama) work
 * too. Streaming is requested via `stream: true` and emitted as `log` events.
 */
import type { NodeContext } from '../types.js'
import { emitLog, emitResult } from './context.js'

export interface LlmMessage {
  readonly role: 'system' | 'user' | 'assistant'
  readonly content: string | readonly { type: string; text?: string; image_url?: string }[]
}

export interface LlmCallConfig {
  readonly model: string
  readonly endpoint: string
  readonly apiKey?: string
  readonly maxTokens: number
  readonly temperature: number
  readonly messages: readonly LlmMessage[]
}

export interface LlmCallResult {
  readonly content: string
  readonly usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }
  readonly finishReason?: string
}

export interface LlmRunOptions {
  readonly fetch?: typeof fetch
}

const FETCHER: typeof fetch = (...args) => fetch(...args)

/** Call an OpenAI-compatible chat completions endpoint. */
export async function callLlm(
  cfg: LlmCallConfig,
  signal: AbortSignal,
  opts: LlmRunOptions = {},
): Promise<LlmCallResult> {
  const fetcher = opts.fetch ?? FETCHER
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (cfg.apiKey) headers['authorization'] = `Bearer ${cfg.apiKey}`

  const ac = new AbortController()
  const onParent = () => ac.abort(signal.reason)
  signal.addEventListener('abort', onParent, { once: true })

  try {
    const response = await fetcher(cfg.endpoint, {
      method: 'POST',
      headers,
      signal: ac.signal,
      body: JSON.stringify({
        model: cfg.model,
        messages: cfg.messages,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: false,
      }),
    })
    if (!response.ok) {
      const text = await response.text()
      throw new Error(`LLM API returned ${response.status}: ${text.slice(0, 500)}`)
    }
    const json = (await response.json()) as {
      choices?: readonly { message?: { content?: string }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    }
    const content = json.choices?.[0]?.message?.content ?? ''
    return {
      content,
      usage: {
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
        totalTokens: json.usage?.total_tokens,
      },
      finishReason: json.choices?.[0]?.finish_reason,
    }
  } finally {
    signal.removeEventListener('abort', onParent)
  }
}

/** Emit the LLM result as a `result` event (and streamed content as `log`s). */
export function emitLlmResult(ctx: NodeContext, result: LlmCallResult): void {
  emitLog(
    ctx,
    `llm.finish reason=${result.finishReason ?? 'n/a'} tokens=${result.usage?.totalTokens ?? 'n/a'}`,
  )
  emitResult(ctx, result.content)
}

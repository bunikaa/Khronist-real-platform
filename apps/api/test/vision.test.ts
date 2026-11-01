import { htrVisionOutputSchema } from '@khronist/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { loadConfig } from '../src/config.ts'
import { selectHtrReader } from '../src/services/htr/index.ts'
import { createVisionReader } from '../src/services/htr/vision.ts'
import { createAnthropicProvider, type AnthropicMessages } from '../src/services/llm/anthropic.ts'
import { LlmOutputError, withFallback, type LlmProvider } from '../src/services/llm/index.ts'

const output = {
  lines: [
    { text: 'Села Борщаговки', words: [{ text: 'Села', uncertain: false }, { text: 'Борщаговки', uncertain: true }] },
    { text: 'оба', words: [{ text: 'оба', uncertain: false }] },
  ],
  warnings: ['cut_off_right'],
}

const reply = (text: string, stop_reason = 'end_turn') => ({
  model: 'claude-test',
  stop_reason,
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text }],
  usage: { input_tokens: 10, output_tokens: 20 },
})

const fakeMessages = (...replies: unknown[]) => {
  const create = vi.fn()
  for (const next of replies) create.mockResolvedValueOnce(next)
  return { create, messages: { create } as unknown as AnthropicMessages }
}

const request = { system: 's', content: [], schema: z.object({ a: z.number() }), maxTokens: 10 }
const noLog = () => undefined

describe('anthropic provider', () => {
  const provider = (messages: AnthropicMessages) =>
    createAnthropicProvider({ messages, model: 'claude-test', effort: 'low' })

  it('sends the schema, effort and refusal fallback, and passes the abort signal', async () => {
    const { create, messages } = fakeMessages(reply('{"a":1}'))
    const signal = new AbortController().signal
    const result = await provider(messages).complete({ ...request, signal })
    expect(result).toEqual({
      value: { a: 1 },
      model: 'claude-test',
      usage: { inputTokens: 10, outputTokens: 20 },
    })
    const [body, options] = create.mock.calls[0] ?? []
    expect(body.fallbacks).toBe('default')
    expect(body.betas).toEqual(['server-side-fallback-2026-07-01'])
    expect(body.output_config.effort).toBe('low')
    expect(body.output_config.format.schema.required).toEqual(['a'])
    expect(body.output_config.format.schema.$schema).toBeUndefined()
    expect(options.signal).toBe(signal)
  })

  it('reports invalid JSON, a wrong shape and a cut-off answer as output errors', async () => {
    for (const bad of [reply('not json'), reply('{"a":"x"}'), reply('{"a":1}', 'max_tokens')]) {
      const { messages } = fakeMessages(bad)
      await expect(provider(messages).complete(request)).rejects.toBeInstanceOf(LlmOutputError)
    }
  })

  it('treats a refusal as a failure that is not retried as bad output', async () => {
    const { messages } = fakeMessages(reply('', 'refusal'))
    const failure = await provider(messages).complete(request).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(LlmOutputError)
  })
})

describe('withFallback', () => {
  const ok = { value: 1, model: 'm', usage: { inputTokens: 0, outputTokens: 0 } }
  const fake = (...outcomes: unknown[]) => {
    const complete = vi.fn()
    for (const outcome of outcomes) {
      if (outcome instanceof Error) complete.mockRejectedValueOnce(outcome)
      else complete.mockResolvedValueOnce(outcome)
    }
    return { complete, provider: { name: 'p', complete } as unknown as LlmProvider }
  }

  it('retries the same model once after invalid output', async () => {
    const primary = fake(new LlmOutputError('bad'), ok)
    await expect(withFallback(primary.provider, undefined, noLog).complete(request)).resolves.toBe(ok)
    expect(primary.complete).toHaveBeenCalledTimes(2)
  })

  it('moves to the fallback after an API error without retrying the primary', async () => {
    const primary = fake(new Error('503'))
    const fallback = fake(ok)
    await expect(withFallback(primary.provider, fallback.provider, noLog).complete(request)).resolves.toBe(ok)
    expect(primary.complete).toHaveBeenCalledTimes(1)
  })

  it('moves to the fallback when both tries give invalid output', async () => {
    const primary = fake(new LlmOutputError('a'), new LlmOutputError('b'))
    const fallback = fake(ok)
    await expect(withFallback(primary.provider, fallback.provider, noLog).complete(request)).resolves.toBe(ok)
  })

  it('does not spend another call after the time limit', async () => {
    const controller = new AbortController()
    controller.abort()
    const primary = fake(new LlmOutputError('late'))
    const fallback = fake(ok)
    await expect(
      withFallback(primary.provider, fallback.provider, noLog).complete({ ...request, signal: controller.signal }),
    ).rejects.toThrow('late')
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).not.toHaveBeenCalled()
  })

  it('throws the error when there is no fallback', async () => {
    const primary = fake(new Error('503'))
    await expect(withFallback(primary.provider, undefined, noLog).complete(request)).rejects.toThrow('503')
  })
})

describe('vision reader', () => {
  it('sends the image and hints and returns estimated lines', async () => {
    const complete = vi.fn().mockResolvedValue({
      value: htrVisionOutputSchema.parse(output),
      model: 'm',
      usage: { inputTokens: 1, outputTokens: 2 },
    })
    const onRead = vi.fn()
    const reader = createVisionReader({ name: 'm', complete } as unknown as LlmProvider, onRead)
    const lines = await reader.read({ image: Buffer.from('png'), hints: { period: '19' } })

    expect(reader.kind).toBe('vision')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ idx: 0, boxSource: 'estimated', uncertain: true })
    expect(lines[0]?.box).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    const sent = complete.mock.calls[0]?.[0]
    expect(sent.content[0].base64).toBe(Buffer.from('png').toString('base64'))
    expect(sent.content[1].text).toContain('Century: 19')
    expect(sent.content[1].text).toContain('Language: unknown')
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ lines: 2, warnings: ['cut_off_right'] }))
  })
})

describe('reader selection', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  const logs = { onRead: noLog, onFailure: noLog }

  it('uses fixtures first, then vision with a key, and nothing without one', () => {
    expect(selectHtrReader(loadConfig({ ...base, LLM_FIXTURES: '1', ANTHROPIC_API_KEY: 'k' }), logs)?.kind).toBe('fixture')
    expect(selectHtrReader(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }), logs)?.name).toBe('claude-opus-5-5')
    expect(selectHtrReader(loadConfig(base), logs)).toBeUndefined()
  })

  it('refuses a model that has no connected provider', () => {
    expect(() => loadConfig({ ...base, HTR_MODEL_FALLBACK: 'gemini-x' })).toThrow(/HTR_MODEL_FALLBACK/)
  })
})

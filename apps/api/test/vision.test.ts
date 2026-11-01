import { htrVisionOutputSchema } from '@khronist/contracts'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { hasKeyFor, loadConfig } from '../src/config.ts'
import { selectHtrReader } from '../src/services/htr/index.ts'
import { createVisionReader } from '../src/services/htr/vision.ts'
import { createAnthropicProvider, type AnthropicMessages } from '../src/services/llm/anthropic.ts'
import { createGeminiProvider, type GeminiInteractions } from '../src/services/llm/gemini.ts'
import { LlmOutputError, withFallback, type LlmProvider } from '../src/services/llm/index.ts'
import type { ProviderFactory } from '../src/services/llm/select.ts'

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

  it('reports invalid JSON and a wrong shape as output errors', async () => {
    for (const bad of [reply('not json'), reply('{"a":"x"}')]) {
      const { messages } = fakeMessages(bad)
      await expect(provider(messages).complete(request)).rejects.toBeInstanceOf(LlmOutputError)
    }
  })

  it('does not treat a refusal or a cut-off answer as output worth repeating', async () => {
    for (const bad of [reply('', 'refusal'), reply('{"a":1}', 'max_tokens')]) {
      const { messages } = fakeMessages(bad)
      const failure = await provider(messages).complete(request).catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure).not.toBeInstanceOf(LlmOutputError)
    }
  })

  it('reads only the answer after a server-side handover and names the model that gave it', async () => {
    const handedOver = {
      model: 'claude-test',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'declined part' },
        { type: 'fallback', from: { model: 'claude-test' }, to: { model: 'claude-other' } },
        { type: 'text', text: '{"a":1}' },
      ],
      usage: {
        input_tokens: 1,
        output_tokens: 2,
        iterations: [{ type: 'message' }, { type: 'fallback_message', model: 'claude-other' }],
      },
    }
    const { messages } = fakeMessages(handedOver)
    const result = await provider(messages).complete(request)
    expect(result.value).toEqual({ a: 1 })
    expect(result.model).toBe('claude-other')
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

  it('moves to the fallback when the primary hangs past its own limit', async () => {
    const hanging = {
      name: 'hanging',
      complete: (r: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          r.signal?.addEventListener('abort', () => reject(new Error('hung')))
        }),
    } as unknown as LlmProvider
    const fallback = fake(ok)
    await expect(withFallback(hanging, fallback.provider, noLog, 10).complete(request)).resolves.toBe(ok)
  })

  it('does not limit the only model when there is no fallback', async () => {
    const primary = fake(ok)
    await withFallback(primary.provider, undefined, noLog, 10).complete(request)
    expect(primary.complete.mock.calls[0]?.[0].signal).toBeUndefined()
  })

  it('retries the fallback once after invalid output too', async () => {
    const primary = fake(new Error('503'))
    const fallback = fake(new LlmOutputError('bad'), ok)
    await expect(withFallback(primary.provider, fallback.provider, noLog).complete(request)).resolves.toBe(ok)
    expect(fallback.complete).toHaveBeenCalledTimes(2)
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
    const { lines, reader: answeredBy } = await reader.read({
      image: Buffer.from('png'),
      hints: { period: '19' },
    })

    expect(reader.kind).toBe('vision')
    expect(answeredBy).toBe('m')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ idx: 0, boxSource: 'estimated', uncertain: true })
    expect(lines[0]?.box).toEqual({ x: 0, y: 0, w: 1, h: 0.5 })
    const sent = complete.mock.calls[0]?.[0]
    expect(sent.content[0].base64).toBe(Buffer.from('png').toString('base64'))
    expect(sent.content[1].text).toContain('Century: 19')
    expect(sent.content[1].text).toContain('Language: unknown')
    expect(onRead).toHaveBeenCalledWith(expect.objectContaining({ lines: 2, warnings: ['cut_off_right'] }))
  })

  const readReply = (lines: unknown) => {
    const { messages } = fakeMessages(reply(JSON.stringify({ lines })))
    const llm = createAnthropicProvider({ messages, model: 'claude-test', effort: 'low' })
    return createVisionReader(llm, noLog).read({ image: Buffer.from('png') })
  }

  it.each([
    ['no words at all', { text: 'Іван Коваленко', words: [] }],
    ['words that differ from the text', { text: 'Іван Коваленко', words: [{ text: 'Іван', uncertain: false }] }],
  ])('rejects %s, because uncertainty marks would not match the text', async (_, line) => {
    await expect(readReply([line])).rejects.toBeInstanceOf(LlmOutputError)
  })

  it('accepts a line that differs from its words only in spacing', async () => {
    const words = [
      { text: 'Іван', uncertain: false },
      { text: 'Коваленко', uncertain: true },
    ]
    const { lines } = await readReply([{ text: ' Іван  Коваленко ', words }])
    expect(lines[0]?.uncertain).toBe(true)
  })
})

describe('reader selection', () => {
  const base = { DATABASE_URL: 'postgres://u:p@localhost:5432/db' }
  const logs = { onRead: noLog, onFailure: noLog }

  it('uses fixtures first, then vision with a key, and nothing without one', () => {
    expect(selectHtrReader(loadConfig({ ...base, LLM_FIXTURES: '1', ANTHROPIC_API_KEY: 'k' }), logs)?.kind).toBe('fixture')
    expect(selectHtrReader(loadConfig({ ...base, ANTHROPIC_API_KEY: 'k' }), logs)?.kind).toBe('vision')
    expect(selectHtrReader(loadConfig(base), logs)).toBeUndefined()
  })

  it('refuses a model that has no connected provider', () => {
    expect(() => loadConfig({ ...base, HTR_MODEL_FALLBACK: 'gpt-x' })).toThrow(/HTR_MODEL_FALLBACK/)
  })

  it('refuses a fallback without its key, so it cannot look like a working safety net', () => {
    expect(() => loadConfig({ ...base, ANTHROPIC_API_KEY: 'k', HTR_MODEL_FALLBACK: 'gemini-x' })).toThrow(
      /HTR_MODEL_FALLBACK/,
    )
  })

  const lineOutput = { lines: [{ text: 'оба', words: [{ text: 'оба', uncertain: false }] }], warnings: [] }
  const providers =
    (broken: string[] = []): ProviderFactory =>
    (config, { model }) => {
      if (!hasKeyFor(config, model)) return undefined
      return {
        name: model,
        complete: async () => {
          if (broken.includes(model)) throw new Error('503')
          return { value: lineOutput, model, usage: { inputTokens: 0, outputTokens: 0 } }
        },
      } as unknown as LlmProvider
    }
  const both = { ...base, ANTHROPIC_API_KEY: 'a', GOOGLE_API_KEY: 'g', HTR_MODEL_FALLBACK: 'gemini-x' }
  const readWith = (env: NodeJS.ProcessEnv, broken?: string[]) =>
    selectHtrReader(loadConfig(env), logs, providers(broken))?.read({ image: Buffer.from('png') })

  it('reads with the primary model while it works', async () => {
    expect((await readWith(both))?.reader).toBe('claude-sonnet-5-5')
  })

  it('wires in the fallback and records it as the reader when the primary fails', async () => {
    expect((await readWith(both, ['claude-sonnet-5-5']))?.reader).toBe('gemini-x')
  })

  it('reads through the fallback alone when only its key is set', async () => {
    const onlyGoogle = { ...base, GOOGLE_API_KEY: 'g', HTR_MODEL_FALLBACK: 'gemini-x' }
    expect((await readWith(onlyGoogle))?.reader).toBe('gemini-x')
  })
})

describe('gemini provider', () => {
  const completed = (text: string | undefined, status = 'completed') => ({
    status,
    output_text: text,
    usage: { total_input_tokens: 10, total_output_tokens: 20, total_thought_tokens: 5 },
  })
  const fakeInteractions = (reply: unknown) => {
    const create = vi.fn().mockResolvedValue(reply)
    return { create, interactions: { create } as unknown as GeminiInteractions }
  }
  const provider = (interactions: GeminiInteractions, notes?: string) =>
    createGeminiProvider({ interactions, model: 'gemini-test', thinkingLevel: 'low', notes })

  it('sends the image, schema, notes and abort signal without hidden retries', async () => {
    const { create, interactions } = fakeInteractions(completed('{"a":1}'))
    const signal = new AbortController().signal
    const image = { type: 'image', mediaType: 'image/png', base64: 'AAA' } as const
    const result = await provider(interactions, 'notes').complete({ ...request, content: [image], signal })

    expect(result).toEqual({ value: { a: 1 }, model: 'gemini-test', usage: { inputTokens: 10, outputTokens: 25 } })
    const [body, options] = create.mock.calls[0] ?? []
    expect(body.system_instruction).toBe('s\n\nnotes')
    expect(body.store).toBe(false)
    expect(body.input).toEqual([{ type: 'image', data: 'AAA', mime_type: 'image/png' }])
    expect(body.generation_config).toEqual({ max_output_tokens: 10, thinking_level: 'low' })
    expect(body.response_format.schema.required).toEqual(['a'])
    expect(body.response_format.schema.$schema).toBeUndefined()
    expect(options).toEqual({ signal, retries: { strategy: 'none' } })
  })

  it('reports invalid JSON, a wrong shape and no text as output errors', async () => {
    for (const bad of [completed('not json'), completed('{"a":"x"}'), completed(undefined)]) {
      const { interactions } = fakeInteractions(bad)
      await expect(provider(interactions).complete(request)).rejects.toBeInstanceOf(LlmOutputError)
    }
  })

  it('does not treat a cut-off answer as output worth repeating', async () => {
    const { interactions } = fakeInteractions(completed('{"a":1}', 'incomplete'))
    const failure = await provider(interactions).complete(request).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(Error)
    expect(failure).not.toBeInstanceOf(LlmOutputError)
  })
})

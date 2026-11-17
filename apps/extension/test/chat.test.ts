import type { ChatResponse } from '@khronist/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { askChat } from '../api/chat.ts'
import { ApiFailure } from '../api/client.ts'
import { chatMessages, chatProblemOf, type ChatTurn } from '../entrypoints/sidepanel/useChat.ts'

vi.mock('wxt/browser', async () => {
  const { fakeStorage } = await import('./fake-storage.ts')
  return { browser: { storage: fakeStorage } }
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const answered: ChatResponse = {
  answer: 'Восприємники — хрещені батьки [1].',
  confidence: 'high',
  citations: [
    {
      kind: 'chunk',
      chunkId: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
      sourceId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
      title: 'Восприемники',
      licence: 'CC BY-SA 4.0',
      retelling: true,
      quote: 'хрещені батьки дитини',
    },
  ],
  followups: ['Хто такі куми?'],
}

const unknown: ChatResponse = { answer: null, reason: 'no_sources', citations: [], followups: [] }

const turn = (question: string, reply: ChatResponse, withRecord = false): ChatTurn => ({
  question,
  reply,
  withRecord,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('askChat', () => {
  it('posts the messages and context and returns the answer by the contract', async () => {
    const fetch = vi.fn().mockResolvedValue(json(answered))
    vi.stubGlobal('fetch', fetch)
    const body = {
      messages: [{ role: 'user' as const, content: 'Хто такі восприємники?' }],
      context: { transcriptionId: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11' },
    }

    await expect(askChat(body, new AbortController().signal)).resolves.toEqual(answered)

    const [url, init] = fetch.mock.calls[0] as [string, RequestInit]
    expect(url).toMatch(/\/v1\/chat$/)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(body)
  })

  it('rejects an answer outside the contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ answer: 'так', citations: [] })))

    await expect(
      askChat({ messages: [{ role: 'user', content: 'Що?' }] }, new AbortController().signal),
    ).rejects.toBeInstanceOf(ZodError)
  })

  it.each([
    [400, 'bad_request', 'Некоректний запит'],
    [413, 'too_large', 'Запит завеликий'],
    [429, 'too_many_requests', 'Забагато запитів, спробуйте за хвилину'],
    [503, 'reader_unavailable', 'Чат тимчасово недоступний'],
    [500, 'internal_error', 'Внутрішня помилка'],
  ])('turns %i into a failure with the API code', async (status, code, message) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ error: { code, message } }, status)))

    const failure = await askChat(
      { messages: [{ role: 'user', content: 'Що?' }] },
      new AbortController().signal,
    ).catch((error: unknown) => error)

    expect(failure).toBeInstanceOf(ApiFailure)
    expect(failure).toMatchObject({ code, message })
  })
})

describe('chatMessages', () => {
  it.each([
    ['the first question alone', [], ['user:4']],
    ['one answered turn', [turn('1', answered)], ['user:1', 'assistant:a', 'user:4']],
    [
      'two answered turns',
      [turn('1', answered), turn('2', answered)],
      ['user:1', 'assistant:a', 'user:2', 'assistant:a', 'user:4'],
    ],
    [
      'three answered turns, cut to the last six and starting with a question',
      [turn('1', answered), turn('2', answered), turn('3', answered)],
      ['user:2', 'assistant:a', 'user:3', 'assistant:a', 'user:4'],
    ],
    [
      'an unknown answer, sent as the text the reader saw',
      [turn('1', unknown, true)],
      ['user:1', 'assistant:u', 'user:4'],
    ],
  ])('sends %s', (_name, turns, expected) => {
    const shown = chatMessages(turns, '4').map(({ role, content }) => {
      if (content === answered.answer) return `${role}:a`
      if (content.startsWith('У ')) return `${role}:u`
      return `${role}:${content}`
    })
    expect(shown).toEqual(expected)
  })

  it('keeps any conversation within the contract limits', () => {
    const many = Array.from({ length: 30 }, (_, index) => turn(String(index), answered))
    const messages = chatMessages(many, 'останнє')
    expect(messages.length).toBeLessThanOrEqual(6)
    expect(messages[0]?.role).toBe('user')
    expect(messages.at(-1)).toEqual({ role: 'user', content: 'останнє' })
  })

  it('says what the unknown answer had in its sources', () => {
    expect(chatMessages([turn('1', unknown, true)], '2')[1]?.content).toBe(
      'У записі й довідковому корпусі немає відповіді на це запитання.',
    )
    expect(chatMessages([turn('1', unknown, false)], '2')[1]?.content).toBe(
      'У довідковому корпусі немає відповіді на це запитання.',
    )
  })
})

describe('chatProblemOf', () => {
  it.each([
    [new ApiFailure('bad_request', 'Некоректний запит'), 'restart', false, 'restartNeeded'],
    [new ApiFailure('too_large', 'Запит завеликий'), 'restart', false, 'restartNeeded'],
    [new ApiFailure('too_many_requests', 'Денний ліміт'), 'dismiss', false, 'Денний ліміт'],
    [new ApiFailure('reader_unavailable', 'Чат недоступний'), 'retry', false, 'Чат недоступний'],
    [new ApiFailure('internal_error', 'Помилка'), 'retry', false, 'Помилка'],
    [
      new ApiFailure('shutting_down', 'Сервер перезапускається'),
      'retry',
      false,
      'Сервер перезапускається',
    ],
    [new TypeError('Failed to fetch'), 'retry', true, 'offline'],
    [new DOMException('timed out', 'TimeoutError'), 'retry', false, 'timedOut'],
    [new ZodError([]), 'retry', false, 'badResponse'],
  ])('maps %o to one action', (error, action, offline, message) => {
    const texts: Record<string, string> = {
      restartNeeded: 'Не вдалося надіслати запитання з цією розмовою. Почніть нову',
      offline: 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз',
      badResponse: 'Сервер відповів неочікувано. Спробуйте ще раз',
      timedOut: 'Сервер не відповів вчасно. Спробуйте ще раз',
    }
    expect(chatProblemOf(error)).toEqual({ action, offline, message: texts[message] ?? message })
  })
})

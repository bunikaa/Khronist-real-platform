import { chatResponseSchema, maxChatMessageLength } from '@khronist/contracts'
import { eq } from 'drizzle-orm'
import { loadProviderNotes } from '@khronist/prompts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { chunks, sources, synonyms, transcriptions } from '../src/db/schema.ts'
import {
  createChatResponder,
  marksEveryCitation,
  selectChatResponder,
} from '../src/services/chat.ts'
import { createExplainer } from '../src/services/explain.ts'
import { LlmLimitError, LlmOutputError, type LlmProvider } from '../src/services/llm/index.ts'
import type { ProviderFactory } from '../src/services/llm/select.ts'
import {
  answering,
  createTestApp,
  createTestDatabase,
  type ModelAnswer,
  promptOf,
  readTranscription,
  resetDatabase,
  type TestDatabase,
  unlimitedBudget,
} from './helpers.ts'

const quote = 'хрещений батько або хрещена мати'
const recordQuote = 'и законная жена его Марія'
const followups = ['Хто такий восприемник?', 'Що таке сажень?']

type Message = { role: 'user' | 'assistant'; content: string }

const ask = (content: string): Message => ({ role: 'user', content })
const reply = (content: string): Message => ({ role: 'assistant', content })

const conversation = (...messages: Message[]) => ({ messages })

const messagesInPrompt = (prompt: string): Message[] =>
  JSON.parse(prompt.slice(prompt.indexOf('Conversation (JSON):\n') + 21)) as Message[]

describe('marksEveryCitation', () => {
  it.each<[string, number, boolean]>([
    ['Так [1].', 1, true],
    ['Перше [1], друге [2].', 2, true],
    ['Друге [2], перше [1].', 2, true],
    ['Двічі [1] і ще раз [1].', 1, true],
    ['Ім’я [нрзб] і факт [1].', 1, true],
    ['Без маркерів.', 1, false],
    ['Лише перше [1].', 2, false],
    ['Зайвий [1] [2].', 1, false],
    ['Нульовий [0].', 1, false],
    ['Перше [1], третє [3].', 2, false],
    ['Маркер без цитат [1].', 0, false],
    ['Без маркерів і без цитат.', 0, false],
  ])('%s with %i citations → %s', (answer, count, expected) => {
    expect(marksEveryCitation(answer, count)).toBe(expected)
  })
})

describe('POST /v1/chat', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.client.close()
  })

  beforeEach(async () => {
    await resetDatabase(database)
    const [source] = await database.db
      .insert(sources)
      .values({
        title: 'Енциклопедичний словник',
        url: 'https://example.org/esbe',
        licence: 'суспільне надбання',
        kind: 'encyclopedia',
        periodFrom: 18,
        periodTo: 20,
      })
      .returning({ id: sources.id })
    const sourceId = source?.id ?? ''
    await database.db.insert(chunks).values([
      {
        sourceId,
        articleKey: 'vospriemnik',
        idx: 0,
        topic: 'Восприемник',
        text: 'Восприемник — хрещений батько або хрещена мати, записані в метричній книзі.',
        type: 'term',
        periodFrom: 18,
        periodTo: 19,
      },
      {
        sourceId,
        articleKey: 'sazhen',
        idx: 0,
        topic: 'Сажень',
        text: 'Сажень — міра довжини, три аршини.',
        type: 'unit',
        periodFrom: 18,
        periodTo: 19,
      },
    ])
    await database.db
      .insert(synonyms)
      .values({ term: 'Восприемник', variant: 'воспріемникъ', type: 'term' })
  })

  const chatWith = async (
    provider: LlmProvider | undefined,
    body: Record<string, unknown>,
    budget = unlimitedBudget,
    minRank = 0.05,
  ) => {
    const chat = createChatResponder({ db: database.db, llm: provider, budget, minRank })
    const { app } = await createTestApp(database, { chat })
    const res = await app.inject({ method: 'POST', url: '/v1/chat', payload: body })
    await app.close()
    return res
  }

  const grounded: ModelAnswer = (ids) => ({
    answer: 'Це хрещені батьки дитини [1].',
    confidence: 'HIGH',
    citations: [{ source: 'chunk', chunkId: ids[0], quote }],
    followups,
  })

  it('answers that it does not know without asking the model when nothing matches and there is no record', async () => {
    const { provider, requests } = answering(grounded)
    const res = await chatWith(provider, conversation(ask('Що таке автомобіль?')))
    expect(res.statusCode).toBe(200)
    expect(chatResponseSchema.parse(res.json())).toEqual({
      answer: null,
      reason: 'no_sources',
      citations: [],
      followups: [],
    })
    expect(requests).toHaveLength(0)
  })

  it('answers from the found articles and cites them with their source', async () => {
    const { provider, requests } = answering(grounded)
    const res = await chatWith(provider, {
      ...conversation(ask('Хто такий воспріемникъ?')),
      context: { period: '19' },
    })
    expect(res.statusCode).toBe(200)
    const body = chatResponseSchema.parse(res.json())
    expect(body).toEqual({
      answer: 'Це хрещені батьки дитини [1].',
      confidence: 'high',
      citations: [
        {
          kind: 'chunk',
          chunkId: expect.any(String),
          sourceId: expect.any(String),
          title: 'Енциклопедичний словник',
          url: 'https://example.org/esbe',
          licence: 'суспільне надбання',
          retelling: true,
          quote,
        },
      ],
      followups,
    })
    const prompt = promptOf(requests[0])
    expect(prompt).toContain('Century: 19')
    expect(prompt).toContain('Record (JSON string or null):\nnull')
    expect(prompt).toContain('"title":"Енциклопедичний словник"')
    expect(messagesInPrompt(prompt)).toEqual([ask('Хто такий воспріемникъ?')])
  })

  it('answers from the record with its stored id and asks the model even when no article matches', async () => {
    const transcription = await readTranscription(database)
    const { provider, requests } = answering(() => ({
      answer: 'Дружину звуть Марія [1].',
      confidence: 'high',
      citations: [{ source: 'record', quote: `${recordQuote} ` }],
      followups,
    }))
    const res = await chatWith(provider, {
      ...conversation(ask('Як звали дружину?')),
      context: { transcriptionId: transcription.id.toUpperCase() },
    })
    expect(res.statusCode).toBe(200)
    expect(chatResponseSchema.parse(res.json())).toEqual({
      answer: 'Дружину звуть Марія [1].',
      confidence: 'high',
      citations: [{ kind: 'record', transcriptionId: transcription.id, quote: recordQuote }],
      followups,
    })
    const prompt = promptOf(requests[0])
    expect(prompt).toContain(JSON.stringify(transcription.normalizedText))
    expect(prompt).toContain('Reference articles (JSON):\n[]')
    expect(prompt).toContain('Century: unknown')
  })

  it('cites the record and an article in one answer', async () => {
    const transcription = await readTranscription(database)
    const { provider } = answering((ids) => ({
      answer: 'Марія [1] — восприемница, тобто хрещена мати [2].',
      confidence: 'low',
      citations: [
        { source: 'record', quote: recordQuote },
        { source: 'chunk', chunkId: ids[0], quote },
      ],
      followups,
    }))
    const res = await chatWith(provider, {
      ...conversation(ask('Хто такий восприемник?')),
      context: { transcriptionId: transcription.id },
    })
    const body = chatResponseSchema.parse(res.json())
    expect(body.confidence).toBe('low')
    expect(body.citations.map((citation) => citation.kind)).toEqual(['record', 'chunk'])
  })

  it.each<[string, ModelAnswer]>([
    [
      'a quote that is not in the article',
      (ids) => ({
        ...grounded(ids),
        citations: [{ source: 'chunk', chunkId: ids[0], quote: 'вигаданий текст про хрещення' }],
      }),
    ],
    [
      'an article that was not given',
      (ids) => ({ ...grounded(ids), citations: [{ source: 'chunk', chunkId: 'other', quote }] }),
    ],
    [
      'a quote shorter than three words and fifteen characters',
      (ids) => ({
        ...grounded(ids),
        citations: [{ source: 'chunk', chunkId: ids[0], quote: 'хрещена мати' }],
      }),
    ],
    [
      'a quote of the record when there is no record',
      (ids) => ({ ...grounded(ids), citations: [{ source: 'record', quote }] }),
    ],
    [
      'a marker beyond the citations',
      (ids) => ({ ...grounded(ids), answer: 'Хрещені батьки [1], записані в книзі [2].' }),
    ],
    [
      'a citation without a marker',
      (ids) => ({ ...grounded(ids), answer: 'Це хрещені батьки дитини.' }),
    ],
    ['an answer without a citation', (ids) => ({ ...grounded(ids), citations: [] })],
    [
      'an answer too long to send back in the conversation',
      (ids) => ({ ...grounded(ids), answer: `${'а'.repeat(maxChatMessageLength - 3)} [1]` }),
    ],
    ['a blank answer', (ids) => ({ ...grounded(ids), answer: '  ', confidence: 'high' })],
    [
      'no answer from the model',
      () => ({ answer: null, confidence: 'low', citations: [], followups }),
    ],
    [
      'one good and one invented quote',
      (ids) => ({
        ...grounded(ids),
        answer: 'Хрещені батьки [1], записані в книзі [2].',
        citations: [
          { source: 'chunk', chunkId: ids[0], quote },
          { source: 'chunk', chunkId: ids[0], quote: 'записані в церковній книзі' },
        ],
      }),
    ],
  ])('turns %s into «не знаю» and keeps the followups', async (_case, answer) => {
    const { provider, requests } = answering(answer)
    const res = await chatWith(provider, conversation(ask('Хто такий восприемник?')))
    expect(requests).toHaveLength(1)
    expect(res.statusCode).toBe(200)
    expect(chatResponseSchema.parse(res.json())).toEqual({
      answer: null,
      reason: 'no_sources',
      citations: [],
      followups,
    })
  })

  it('gives the model no articles below the threshold even with a record, and rejects citing them', async () => {
    const transcription = await readTranscription(database)
    const [article] = await database.db
      .select({ id: chunks.id })
      .from(chunks)
      .where(eq(chunks.articleKey, 'vospriemnik'))
    const { provider, requests } = answering(() => ({
      answer: 'Хрещені батьки [1].',
      confidence: 'high',
      citations: [{ source: 'chunk', chunkId: article?.id, quote }],
      followups,
    }))
    const res = await chatWith(
      provider,
      {
        ...conversation(ask('Хто такий восприемник?')),
        context: { transcriptionId: transcription.id },
      },
      unlimitedBudget,
      10,
    )
    expect(promptOf(requests[0])).toContain('Reference articles (JSON):\n[]')
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [], followups })
  })

  it('checks a record quote against the record, not against the articles', async () => {
    const transcription = await readTranscription(database)
    const { provider } = answering(() => ({
      answer: 'Хрещені батьки [1].',
      confidence: 'high',
      citations: [{ source: 'record', quote }],
      followups,
    }))
    const res = await chatWith(provider, {
      ...conversation(ask('Хто такий восприемник?')),
      context: { transcriptionId: transcription.id },
    })
    expect(res.json()).toMatchObject({ answer: null, reason: 'no_sources', citations: [] })
  })

  it('keeps an answer exactly as long as a chat message may be', async () => {
    const answer = `${'а'.repeat(maxChatMessageLength - 4)} [1]`
    const { provider } = answering((ids) => ({ ...grounded(ids), answer }))
    const res = await chatWith(provider, conversation(ask('Хто такий восприемник?')))
    expect(res.json().answer).toBe(answer)
  })

  it('returns at most three trimmed followups that can be asked back', async () => {
    const longest = 'в'.repeat(maxChatMessageLength)
    const { provider } = answering((ids) => ({
      ...grounded(ids),
      followups: [' Перше? ', '', `${longest}в`, 'Друге?', ` ${longest} `, 'Четверте?'],
    }))
    const res = await chatWith(provider, conversation(ask('Хто такий восприемник?')))
    expect(res.json().followups).toEqual(['Перше?', 'Друге?', longest])
  })

  it('treats a transcription with an empty text as a chat without a record', async () => {
    const transcription = await readTranscription(database)
    await database.db
      .update(transcriptions)
      .set({ normalizedText: ' \n ' })
      .where(eq(transcriptions.id, transcription.id))
    const { provider, requests } = answering(grounded)
    const res = await chatWith(provider, {
      ...conversation(ask('Що таке автомобіль?')),
      context: { transcriptionId: transcription.id },
    })
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [], followups: [] })
    expect(requests).toHaveLength(0)
  })

  it('treats an unknown transcription as a chat without a record', async () => {
    const { provider, requests } = answering(grounded)
    const res = await chatWith(provider, {
      ...conversation(ask('Що таке автомобіль?')),
      context: { transcriptionId: '0190a6b2-0000-7000-8000-000000000000' },
    })
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [], followups: [] })
    expect(requests).toHaveLength(0)
  })

  it('gives the model at most six last messages, starting with a question', async () => {
    const { provider, requests } = answering(grounded)
    const messages = [
      ask('Питання 1'),
      reply('Відповідь 1'),
      ask('Питання 2'),
      reply('Відповідь 2'),
      ask('Питання 3'),
      reply('Відповідь 3'),
      ask('Питання 4'),
      reply('Відповідь 4'),
      ask('Хто такий восприемник?'),
    ]
    await chatWith(provider, { messages })
    expect(messagesInPrompt(promptOf(requests[0]))).toEqual(messages.slice(-5))
  })

  it('searches the articles by the previous question too, but not by the answers', async () => {
    const { provider, requests } = answering(grounded)
    await chatWith(
      provider,
      conversation(
        ask('Хто такий восприемник?'),
        reply('Хрещений батько [1].'),
        ask('Що таке сажень?'),
        reply('Міра довжини, і восприемник тут ні до чого [1].'),
        ask('А докладніше?'),
      ),
    )
    const prompt = promptOf(requests[0])
    expect(prompt).toContain('Сажень — міра довжини')
    expect(prompt).not.toContain('Восприемник — хрещений')
  })

  it('searches by the last question first', async () => {
    const { provider, requests } = answering(grounded)
    const longQuestion = `Що таке сажень? ${'Поясніть докладно кожне значення. '.repeat(10)}`
    await chatWith(
      provider,
      conversation(ask('Хто такий восприемник?'), reply('Хрещений батько [1].'), ask(longQuestion)),
    )
    const prompt = promptOf(requests[0])
    expect(prompt).toContain('Сажень — міра довжини')
    expect(prompt).not.toContain('Восприемник — хрещений')
  })

  it('asks the text models with the chat notes for the fallback, and no model with fixtures', async () => {
    const made: unknown[] = []
    const makeProvider: ProviderFactory = (_config, settings) => {
      made.push(settings)
      return answering(grounded).provider
    }
    const base = {
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
      ANTHROPIC_API_KEY: 'k',
      GOOGLE_API_KEY: 'g',
      LLM_MODEL_FALLBACK: 'gemini-3.6-flash',
    }
    const question = { messages: [ask('Хто такий восприемник?')] }
    const chat = selectChatResponder(loadConfig(base), database.db, unlimitedBudget, makeProvider)
    expect((await chat(question)).answer).toBe('Це хрещені батьки дитини [1].')
    const geminiNotes = loadProviderNotes('chat', 'gemini')
    expect(made).toEqual([
      { model: 'claude-sonnet-5-5', effort: 'medium', geminiNotes },
      { model: 'gemini-3.6-flash', effort: 'medium', geminiNotes },
    ])
    made.length = 0
    const fixtures = loadConfig({ ...base, LLM_FIXTURES: '1' })
    const offline = selectChatResponder(fixtures, database.db, unlimitedBudget, makeProvider)
    await expect(offline(question)).rejects.toMatchObject({ statusCode: 503 })
    expect(made).toHaveLength(0)
  })

  it.each<[string, LlmProvider | undefined]>([
    ['no model is configured', undefined],
    [
      'the model budget is spent',
      {
        name: 'claude-test',
        complete: async () => {
          throw new LlmLimitError('the daily model call budget is spent')
        },
      },
    ],
    [
      'the model output is unusable',
      {
        name: 'claude-test',
        complete: async () => {
          throw new LlmOutputError('the model output does not match the schema')
        },
      },
    ],
  ])('answers 503 when %s', async (_case, provider) => {
    const res = await chatWith(provider, conversation(ask('Хто такий восприемник?')))
    expect(res.statusCode).toBe(503)
    expect(res.json().error).toEqual({
      code: 'reader_unavailable',
      message: 'Чат тимчасово недоступний',
    })
  })

  it('answers 503 for a question about the record when no model is configured', async () => {
    const transcription = await readTranscription(database)
    const res = await chatWith(undefined, {
      ...conversation(ask('Що таке автомобіль?')),
      context: { transcriptionId: transcription.id },
    })
    expect(res.statusCode).toBe(503)
  })

  it('keeps a quarter of the model budget for reading', async () => {
    const { provider, requests } = answering(grounded)
    const shares: (number | undefined)[] = []
    const res = await chatWith(provider, conversation(ask('Хто такий восприемник?')), {
      spend: async () => true,
      available: async (share) => {
        shares.push(share)
        return false
      },
    })
    expect(res.statusCode).toBe(503)
    expect(shares).toEqual([0.75])
    expect(requests).toHaveLength(0)
  })

  it.each<[string, unknown, number]>([
    ['no messages', { messages: [] }, 400],
    ['a last message from the assistant', conversation(ask('Що?'), reply('Це.')), 400],
    ['more than 20 messages', { messages: Array.from({ length: 21 }, () => ask('Що?')) }, 400],
    ['an empty message', conversation(ask('  ')), 400],
    ['a message over 2000 characters', conversation(ask('а'.repeat(2001))), 400],
    ['an unknown role', { messages: [{ role: 'system', content: 'Що?' }] }, 400],
    [
      'a transcription id that is not a UUID',
      { ...conversation(ask('Що?')), context: { transcriptionId: 'abc' } },
      400,
    ],
    [
      'a period that is not a century',
      { ...conversation(ask('Що?')), context: { period: '1884' } },
      400,
    ],
    [
      'a body over 32 KB',
      { messages: Array.from({ length: 20 }, () => ask('а'.repeat(1900))) },
      413,
    ],
  ])('refuses %s', async (_case, body, status) => {
    const res = await chatWith(answering(grounded).provider, body as Record<string, unknown>)
    expect(res.statusCode).toBe(status)
    expect(res.json().error.code).toBe(status === 413 ? 'too_large' : 'bad_request')
  })

  const guestChat = (guestChatsPerDay?: number) =>
    createTestApp(database, {
      chat: createChatResponder({
        db: database.db,
        llm: undefined,
        budget: unlimitedBudget,
        minRank: 0.05,
      }),
      explain: createExplainer({
        db: database.db,
        llm: undefined,
        budget: unlimitedBudget,
        minRank: 0.05,
      }),
      guestChatsPerDay,
    })

  const unknownQuestion = conversation(ask('Що таке автомобіль?'))

  it('lets a guest ask a limited number of questions a day', async () => {
    const { app } = await guestChat(3)
    const post = () => app.inject({ method: 'POST', url: '/v1/chat', payload: unknownQuestion })
    const codes = [(await post()).statusCode, (await post()).statusCode, (await post()).statusCode]
    const over = await post()
    await app.close()
    expect(codes).toEqual([200, 200, 200])
    expect(over.statusCode).toBe(429)
    expect(over.json().error).toEqual({
      code: 'too_many_requests',
      message: 'Денний ліміт запитань чату вичерпано, спробуйте завтра',
    })
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('lets a guest ask ten times a minute, apart from explanations', async () => {
    const { app } = await guestChat()
    const explains: number[] = []
    for (let n = 0; n < 10; n += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/explain',
        payload: { kind: 'term', text: 'автомобіль' },
      })
      explains.push(res.statusCode)
    }
    const codes: number[] = []
    for (let n = 0; n < 11; n += 1) {
      const res = await app.inject({ method: 'POST', url: '/v1/chat', payload: unknownQuestion })
      codes.push(res.statusCode)
    }
    const last = await app.inject({ method: 'POST', url: '/v1/chat', payload: unknownQuestion })
    await app.close()
    expect(explains.every((code) => code === 200)).toBe(true)
    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true)
    expect(codes[10]).toBe(429)
    expect(last.json().error).toEqual({
      code: 'too_many_requests',
      message: 'Забагато запитів, спробуйте за хвилину',
    })
  })
})

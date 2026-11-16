import { explainResponseSchema } from '@khronist/contracts'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chunks, sources, synonyms } from '../src/db/schema.ts'
import { createExplainer } from '../src/services/explain.ts'
import {
  LlmLimitError,
  LlmOutputError,
  parseOutput,
  type LlmProvider,
  type LlmRequest,
} from '../src/services/llm/index.ts'
import {
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  type TestDatabase,
  unlimitedBudget,
} from './helpers.ts'

type Answer = (chunkIds: string[]) => Record<string, unknown>

const answering = (answer: Answer) => {
  const requests: LlmRequest<unknown>[] = []
  const provider: LlmProvider = {
    name: 'claude-test',
    complete: async (request) => {
      requests.push(request)
      const part = request.content[0]
      const prompt = part?.type === 'text' ? part.text : ''
      const ids = [...prompt.matchAll(/"chunkId":"([^"]+)"/g)].map((match) => match[1] ?? '')
      return {
        value: parseOutput(JSON.stringify(answer(ids)), request.schema),
        model: 'claude-test',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
  }
  return { provider, requests }
}

const promptOf = (request: LlmRequest<unknown> | undefined) => {
  const part = request?.content[0]
  return part?.type === 'text' ? part.text : ''
}

const quote = 'хрещений батько або хрещена мати'

describe('POST /v1/explain', () => {
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
        articleKey: 'henvar',
        idx: 0,
        topic: 'Генвар',
        text: 'Генвар — старе написання січня: у записах 12 генваря означає 12 січня за старим стилем.',
        type: 'date',
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

  const explainWith = async (
    provider: LlmProvider | undefined,
    body: Record<string, unknown>,
    budget = unlimitedBudget,
  ) => {
    const explain = createExplainer({ db: database.db, llm: provider, budget, minRank: 0.05 })
    const { app } = await createTestApp(database, { explain })
    const res = await app.inject({ method: 'POST', url: '/v1/explain', payload: body })
    await app.close()
    return res
  }

  const grounded: Answer = (ids) => ({
    answer: 'Хрещені батьки дитини.',
    confidence: 'HIGH',
    citations: [{ chunkId: ids[0], quote }],
  })

  it('answers that it does not know without asking the model when nothing matches', async () => {
    const { provider, requests } = answering(grounded)
    const res = await explainWith(provider, { kind: 'term', text: 'автомобіль' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [] })
    expect(requests).toHaveLength(0)
  })

  it('computes a date by code even when the corpus has nothing on it', async () => {
    const { provider, requests } = answering(grounded)
    const res = await explainWith(provider, { kind: 'date', text: '3 марта 1884' })
    expect(res.json()).toEqual({
      answer: null,
      reason: 'no_sources',
      citations: [],
      date: { julian: '3 березня 1884', gregorian: '15 березня 1884', weekday: 'субота' },
    })
    expect(requests).toHaveLength(0)
  })

  it('answers from the found articles and cites them with their source', async () => {
    const { provider, requests } = answering(grounded)
    const res = await explainWith(provider, {
      kind: 'term',
      text: 'воспріемникъ',
      context: { period: '19' },
    })
    expect(res.statusCode).toBe(200)
    const body = explainResponseSchema.parse(res.json())
    expect(body).toMatchObject({
      answer: 'Хрещені батьки дитини.',
      confidence: 'high',
      citations: [
        {
          kind: 'chunk',
          title: 'Енциклопедичний словник',
          url: 'https://example.org/esbe',
          licence: 'суспільне надбання',
          retelling: true,
          quote,
        },
      ],
    })
    expect(body.reason).toBeUndefined()
    const prompt = promptOf(requests[0])
    expect(prompt).toContain('"воспріемникъ"')
    expect(prompt).toContain('Century: 19')
    expect(prompt).toContain('Record (JSON string or null, context only):\nnull')
    expect(prompt).toContain('"title":"Енциклопедичний словник"')
  })

  it.each<[string, Answer]>([
    [
      'a quote that is not in the article',
      (ids) => ({
        ...grounded(ids),
        citations: [{ chunkId: ids[0], quote: 'вигаданий текст про хрещення' }],
      }),
    ],
    [
      'an article that was not given',
      () => ({ answer: 'Так.', confidence: 'high', citations: [{ chunkId: 'other', quote }] }),
    ],
    ['an answer without a citation', () => ({ answer: 'Так.', confidence: 'high', citations: [] })],
    ['no answer from the model', () => ({ answer: null, confidence: 'low', citations: [] })],
    [
      'a blank answer',
      (ids) => ({ answer: '  ', confidence: 'high', citations: [{ chunkId: ids[0], quote }] }),
    ],
    [
      'a true quote attributed to another article',
      (ids) => ({
        answer: 'Так.',
        confidence: 'high',
        citations: ids.map((chunkId) => ({ chunkId, quote })),
      }),
    ],
  ])('turns %s into «не знаю»', async (_case, answer) => {
    const { provider, requests } = answering(answer)
    const res = await explainWith(provider, { kind: 'term', text: 'восприемник сажень' })
    expect(requests).toHaveLength(1)
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [] })
  })

  it('adds the computed date to an answer from a date article', async () => {
    const { provider } = answering((ids) => ({
      answer: 'Січень за старим стилем.',
      confidence: 'high',
      citations: [{ chunkId: ids[0], quote: 'старе написання січня' }],
    }))
    const res = await explainWith(provider, { kind: 'date', text: '12 генваря 1884' })
    expect(res.json()).toMatchObject({
      answer: 'Січень за старим стилем.',
      date: { julian: '12 січня 1884', gregorian: '24 січня 1884', weekday: 'четвер' },
    })
  })

  it('keeps the computed date when the model cannot answer', async () => {
    const res = await explainWith(undefined, { kind: 'date', text: '12 генваря 1884' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      answer: null,
      citations: [],
      date: { julian: '12 січня 1884', gregorian: '24 січня 1884', weekday: 'четвер' },
    })
  })

  it('looks for a place only among place articles', async () => {
    const { provider, requests } = answering(grounded)
    const res = await explainWith(provider, { kind: 'place', text: 'сажень' })
    expect(res.json()).toEqual({ answer: null, reason: 'no_sources', citations: [] })
    expect(requests).toHaveLength(0)
  })

  it('trims the quote it returns to the exact fragment', async () => {
    const { provider } = answering((ids) => ({
      ...grounded(ids),
      citations: [{ chunkId: ids[0], quote: `  ${quote}\n` }],
    }))
    const res = await explainWith(provider, { kind: 'term', text: 'восприемник' })
    expect(res.json().citations[0].quote).toBe(quote)
  })

  it('searches every kind of term article for a term, not only the type term', async () => {
    const { provider, requests } = answering(() => ({
      answer: 'Міра довжини.',
      confidence: 'low',
      citations: [],
    }))
    await explainWith(provider, { kind: 'term', text: 'сажень' })
    expect(promptOf(requests[0])).toContain('Сажень — міра довжини')
  })

  it('gives the model the record of the transcription as context', async () => {
    const { app, queue } = await createTestApp(database)
    const created = await app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(makePng(200, 100)),
    })
    await queue.onIdle()
    const state = await app.inject({
      method: 'GET',
      url: `/v1/recognitions/${created.json().recognitionId}`,
    })
    await app.close()
    const transcription = state.json().transcription
    const { provider, requests } = answering(grounded)
    await explainWith(provider, {
      kind: 'term',
      text: 'восприемник',
      context: { transcriptionId: transcription.id },
    })
    expect(promptOf(requests[0])).toContain(JSON.stringify(transcription.normalizedText))
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
    const res = await explainWith(provider, { kind: 'term', text: 'восприемник' })
    expect(res.statusCode).toBe(503)
    expect(res.json().error.code).toBe('reader_unavailable')
  })

  it('keeps a quarter of the model budget for reading', async () => {
    const { provider, requests } = answering(grounded)
    const shares: (number | undefined)[] = []
    const res = await explainWith(
      provider,
      { kind: 'term', text: 'восприемник' },
      {
        spend: async () => true,
        available: async (share) => {
          shares.push(share)
          return false
        },
      },
    )
    expect(res.statusCode).toBe(503)
    expect(shares).toEqual([0.75])
    expect(requests).toHaveLength(0)
  })

  it.each([
    ['an empty text', { kind: 'term', text: ' ' }, 400],
    ['a text over 200 characters', { kind: 'term', text: 'а'.repeat(201) }, 400],
    ['an unknown kind', { kind: 'person', text: 'Іван' }, 400],
    ['a body over 32 KB', { kind: 'term', text: 'а', note: 'а'.repeat(40_000) }, 413],
  ])('refuses %s', async (_case, body, status) => {
    const res = await explainWith(answering(grounded).provider, body)
    expect(res.statusCode).toBe(status)
  })

  it('lets a guest ask a limited number of times a day', async () => {
    const explain = createExplainer({
      db: database.db,
      llm: undefined,
      budget: unlimitedBudget,
      minRank: 0.05,
    })
    const { app } = await createTestApp(database, { explain, guestExplainsPerDay: 3 })
    const ask = () =>
      app.inject({
        method: 'POST',
        url: '/v1/explain',
        payload: { kind: 'term', text: 'автомобіль' },
      })
    const codes = [(await ask()).statusCode, (await ask()).statusCode, (await ask()).statusCode]
    const over = await ask()
    await app.close()
    expect(codes).toEqual([200, 200, 200])
    expect(over.statusCode).toBe(429)
    expect(over.json().error).toEqual({
      code: 'too_many_requests',
      message: 'Денний ліміт пояснень вичерпано, спробуйте завтра',
    })
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0)
  })

  it('lets a guest ask ten times a minute', async () => {
    const explain = createExplainer({
      db: database.db,
      llm: undefined,
      budget: unlimitedBudget,
      minRank: 0.05,
    })
    const { app } = await createTestApp(database, { explain })
    const codes: number[] = []
    for (let n = 0; n < 11; n += 1) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/explain',
        payload: { kind: 'term', text: 'автомобіль' },
      })
      codes.push(res.statusCode)
    }
    const last = await app.inject({
      method: 'POST',
      url: '/v1/explain',
      payload: { kind: 'term', text: 'автомобіль' },
    })
    await app.close()
    expect(codes.slice(0, 10).every((code) => code === 200)).toBe(true)
    expect(codes[10]).toBe(429)
    expect(last.json().error).toEqual({
      code: 'too_many_requests',
      message: 'Забагато запитів, спробуйте за хвилину',
    })
  })
})

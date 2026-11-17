import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { ApiFailure, createApiClient } from '../src/api.ts'
import { transcription } from './fixtures.ts'

const recognitionId = '01a1e4ff-346f-7b54-a981-ad819ff12382'
const imageBase64 = Buffer.from('png bytes').toString('base64')

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const fakeApi = (responses: Response[], waitLimitMs = 10_000) => {
  const calls: { url: string; init: RequestInit | undefined }[] = []
  const fetchStub: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init })
    const next = responses.shift()
    if (!next) throw new Error('unexpected request')
    return next
  }
  const client = createApiClient({
    baseUrl: 'https://api.example',
    apiKey: 'khr_test',
    fetch: fetchStub,
    pollIntervalMs: 0,
    waitLimitMs,
  })
  return { calls, client }
}

describe('transcribe', () => {
  it('sends the fragment with its hash and the key, and returns a cached reading', async () => {
    const { calls, client } = fakeApi([
      reply(201, { recognitionId, status: 'cached', transcriptionId: transcription.id }),
      reply(200, { recognitionId, status: 'done', transcription }),
    ])
    await expect(client.transcribe({ imageBase64 })).resolves.toEqual(transcription)
    const body: unknown = JSON.parse(String(calls[0]?.init?.body))
    expect(body).toEqual({
      image: { base64Png: imageBase64 },
      imageHash: createHash('sha256').update('png bytes').digest('hex'),
      source: 'mcp',
    })
    expect(calls[0]?.init?.headers).toMatchObject({ authorization: 'Bearer khr_test' })
    expect(calls[1]?.url).toBe(`https://api.example/v1/recognitions/${recognitionId}`)
  })

  it('waits until the reading is done', async () => {
    const { calls, client } = fakeApi([
      reply(201, { recognitionId, status: 'queued' }),
      reply(200, { recognitionId, status: 'queued' }),
      reply(200, { recognitionId, status: 'reading' }),
      reply(200, { recognitionId, status: 'done', transcription }),
    ])
    await expect(client.transcribe({ imageBase64 })).resolves.toEqual(transcription)
    expect(calls).toHaveLength(4)
  })

  it('fails with the code of a failed reading', async () => {
    const { client } = fakeApi([
      reply(201, { recognitionId, status: 'queued' }),
      reply(200, {
        recognitionId,
        status: 'failed',
        error: { code: 'no_text', message: 'На фрагменті не знайдено тексту' },
      }),
    ])
    await expect(client.transcribe({ imageBase64 })).rejects.toMatchObject({ code: 'no_text' })
  })

  it('passes an API error on with its code and message', async () => {
    const { client } = fakeApi([
      reply(429, { error: { code: 'too_many_requests', message: 'Забагато запитів' } }),
    ])
    const failure = client.transcribe({ imageBase64 })
    await expect(failure).rejects.toBeInstanceOf(ApiFailure)
    await expect(failure).rejects.toThrow('too_many_requests: Забагато запитів')
  })

  it('asks to call again when the reading takes longer than the limit', async () => {
    const { client } = fakeApi(
      [
        reply(201, { recognitionId, status: 'queued' }),
        reply(200, { recognitionId, status: 'queued' }),
      ],
      0,
    )
    await expect(client.transcribe({ imageBase64 })).rejects.toMatchObject({
      code: 'still_reading',
    })
  })

  it('names the API when it cannot be reached', async () => {
    const client = createApiClient({
      baseUrl: 'https://api.example',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    })
    await expect(client.transcribe({ imageBase64 })).rejects.toMatchObject({
      code: 'unreachable',
      message: 'unreachable: API https://api.example недоступний (fetch failed)',
    })
  })
})

describe('explain', () => {
  it('posts the question and returns the answer', async () => {
    const { calls, client } = fakeApi([
      reply(200, { answer: null, reason: 'no_sources', citations: [] }),
    ])
    await expect(client.explain({ kind: 'term', text: 'однодворецъ' })).resolves.toEqual({
      answer: null,
      reason: 'no_sources',
      citations: [],
    })
    expect(calls[0]?.url).toBe('https://api.example/v1/explain')
  })
})

describe('search', () => {
  it('asks GET /v1/search with the query and filters', async () => {
    const { calls, client } = fakeApi([reply(200, { items: [] })])
    await expect(
      client.search({ query: 'Кононенко', verifiedOnly: true, limit: 5 }),
    ).resolves.toEqual({ items: [] })
    const url = new URL(calls[0]?.url ?? '')
    expect(url.pathname).toBe('/v1/search')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'Кононенко',
      verifiedOnly: 'true',
      limit: '5',
    })
    expect(calls[0]?.init?.method).toBe('GET')
  })
})

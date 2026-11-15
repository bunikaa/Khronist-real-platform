import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recordReadsPerMinute } from '../src/lib/limits.ts'
import { insertTranscriptionVersion } from '../src/services/transcriptions.ts'
import {
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  type TestDatabase,
} from './helpers.ts'

const sprava = { archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: '1954' }
const lookupUrl = (query: Record<string, string>) =>
  `/v1/pages/lookup?${new URLSearchParams({ ...sprava, ...query }).toString()}`

let size = 100
const nextPng = () => makePng((size += 1), 200)

let database: TestDatabase

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

beforeEach(async () => {
  await resetDatabase(database)
})

type Created = Awaited<ReturnType<typeof createTestApp>>

const read = async ({ app, queue }: Created, extra: Record<string, unknown> = {}) => {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/recognitions',
    payload: recognitionBody(nextPng(), extra),
  })
  await queue.onIdle()
  const state = await app.inject({
    method: 'GET',
    url: `/v1/recognitions/${created.json().recognitionId}`,
  })
  return state.json().transcription
}

describe('GET /v1/transcriptions/:id', () => {
  it('returns the whole transcription', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark: { ...sprava, image: 4 } })
    const res = await created.app.inject({
      method: 'GET',
      url: `/v1/transcriptions/${transcription.id}`,
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual(transcription)
    expect(res.json().shelfmark).toEqual({ ...sprava, image: 4 })
    await created.app.close()
  })

  it('answers 404 for an unknown transcription', async () => {
    const { app } = await createTestApp(database)
    const res = await app.inject({
      method: 'GET',
      url: '/v1/transcriptions/0190a000-0000-7000-8000-000000000000',
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    await app.close()
  })
})

describe('GET /v1/pages/lookup', () => {
  it('answers without a page when the sheet was never read', async () => {
    const { app } = await createTestApp(database)
    const res = await app.inject({ method: 'GET', url: lookupUrl({ image: '4' }) })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({})
    await app.close()
  })

  it('lists the latest version of every region on the sheet', async () => {
    const created = await createTestApp(database)
    const first = await read(created, {
      shelfmark: { ...sprava, image: 4 },
      box: { x: 0, y: 0, w: 1, h: 0.5 },
    })
    const second = await read(created, {
      shelfmark: { ...sprava, image: 4 },
      box: { x: 0, y: 0.5, w: 1, h: 0.5 },
    })
    await read(created, { shelfmark: { ...sprava, image: 5 } })
    const newer = await insertTranscriptionVersion(database.db, {
      regionId: first.regionId,
      reader: 'fixture',
      lines: first.lines,
      warnings: [],
      normalized: null,
      entities: [],
    })

    const res = await created.app.inject({ method: 'GET', url: lookupUrl({ image: '4' }) })
    expect(res.statusCode).toBe(200)
    const { page } = res.json()
    expect(page.shelfmark).toEqual({ ...sprava, image: 4 })
    expect(page.transcriptions).toEqual([
      {
        id: newer,
        regionId: first.regionId,
        box: first.box,
        version: 2,
        status: 'draft',
        createdAt: expect.any(String),
      },
      {
        id: second.id,
        regionId: second.regionId,
        box: second.box,
        version: 1,
        status: 'draft',
        createdAt: second.createdAt,
      },
    ])
    await created.app.close()
  })

  it('finds a sheet by its folio', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark: { ...sprava, folio: '14зв' } })
    const res = await created.app.inject({ method: 'GET', url: lookupUrl({ folio: '14зв' }) })
    expect(res.json().page.transcriptions.map((t: { id: string }) => t.id)).toEqual([
      transcription.id,
    ])
    await created.app.close()
  })

  it('needs a folio or an image', async () => {
    const { app } = await createTestApp(database)
    const res = await app.inject({ method: 'GET', url: lookupUrl({}) })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    await app.close()
  })

  it(`allows ${recordReadsPerMinute} lookups a minute from one address`, async () => {
    const { app } = await createTestApp(database)
    const url = lookupUrl({ image: '4' })
    for (let i = 0; i < recordReadsPerMinute; i += 1) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(200)
    }
    const limited = await app.inject({ method: 'GET', url })
    expect(limited.statusCode).toBe(429)
    expect(limited.headers['retry-after']).toBeDefined()
    await app.close()
  })
})

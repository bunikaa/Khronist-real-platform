import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documents, pages, recognitions } from '../src/db/schema.ts'
import { apiKeyLookupsPerMinute } from '../src/lib/limits.ts'
import { createApiKey } from '../src/services/api-keys.ts'
import {
  createRecordingReader,
  failingReader,
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  type TestDatabase,
} from './helpers.ts'

const sprava = { archive: 'ЦДІАК', fond: '127', opys: '177', sprava: '1078' }
const portalUrl = 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611'
const batchShelfmark = { ...sprava, image: 4, folio: '3зв', portal: 'archium', portalUrl }
const document = { yearFrom: 1896, yearTo: 1896 }

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

const send = (app: Created['app'], payload: object, key?: string) =>
  app.inject({
    method: 'POST',
    url: '/v1/recognitions',
    payload,
    ...(key !== undefined && { headers: { authorization: `Bearer ${key}` } }),
  })

const transcriptionOf = async ({ app, queue }: Created, recognitionId: string) => {
  await queue.onIdle()
  const state = await app.inject({ method: 'GET', url: `/v1/recognitions/${recognitionId}` })
  return state.json().transcription
}

describe('API keys on POST /v1/recognitions', () => {
  it('does not spend the guest daily limit with a key, and still does without one', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database, { guestRecognitionsPerDay: 1 })
    expect((await send(created.app, recognitionBody(nextPng()), key)).statusCode).toBe(201)
    expect((await send(created.app, recognitionBody(nextPng()), key)).statusCode).toBe(201)
    expect((await send(created.app, recognitionBody(nextPng()))).statusCode).toBe(201)
    expect((await send(created.app, recognitionBody(nextPng()))).statusCode).toBe(429)
    await created.queue.onIdle()
    await created.app.close()
  })

  it('has its own daily limit', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database, { apiKeyRecognitionsPerDay: 1 })
    expect((await send(created.app, recognitionBody(nextPng()), key)).statusCode).toBe(201)
    const limited = await send(created.app, recognitionBody(nextPng()), key)
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    await created.queue.onIdle()
    await created.app.close()
  })

  it('counts ten requests a minute per key, apart from guests at the same address', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    const payload = recognitionBody(nextPng())
    await send(created.app, payload, key)
    await created.queue.onIdle()
    for (let i = 1; i < 10; i += 1) await send(created.app, payload, key)
    expect((await send(created.app, payload, key)).statusCode).toBe(429)
    expect((await send(created.app, payload)).statusCode).toBe(201)
    await created.app.close()
  })

  it('answers 401 for an unknown key and creates nothing', async () => {
    await createApiKey(database.db, 'batch')
    const { app } = await createTestApp(database)
    const res = await send(app, recognitionBody(nextPng()), 'khr_unknown')
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    expect(await database.db.select().from(recognitions)).toHaveLength(0)
    await app.close()
  })

  it('treats another bearer token, such as a session, as a guest', async () => {
    const created = await createTestApp(database)
    const res = await send(created.app, recognitionBody(nextPng()), 'session-token')
    expect(res.statusCode).toBe(201)
    await created.queue.onIdle()
    await created.app.close()
  })

  it('keeps the portal, its link, the folio and the years of the file sent with a key', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    const res = await send(
      created.app,
      recognitionBody(nextPng(), { shelfmark: batchShelfmark, source: 'batch', document }),
      key,
    )
    const transcription = await transcriptionOf(created, res.json().recognitionId)
    expect(transcription.shelfmark).toEqual(batchShelfmark)
    const [row] = await database.db.select().from(documents)
    expect([row?.yearFrom, row?.yearTo]).toEqual([1896, 1896])
    await created.app.close()
  })

  it('keeps no metadata from a guest', async () => {
    const created = await createTestApp(database)
    const res = await send(
      created.app,
      recognitionBody(nextPng(), { shelfmark: batchShelfmark, document }),
    )
    const transcription = await transcriptionOf(created, res.json().recognitionId)
    expect(transcription.shelfmark).toEqual({ ...sprava, image: 4 })
    const [row] = await database.db.select().from(documents)
    expect([row?.portal, row?.yearFrom]).toEqual([null, null])
    await created.app.close()
  })

  it('adds the metadata when a key sends a fragment a guest has already read', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    const png = nextPng()
    const guest = await send(created.app, recognitionBody(png, { shelfmark: batchShelfmark }))
    await transcriptionOf(created, guest.json().recognitionId)

    const batch = await send(
      created.app,
      recognitionBody(png, { shelfmark: batchShelfmark, source: 'batch', document }),
      key,
    )
    expect(batch.json().status).toBe('cached')
    const transcription = await transcriptionOf(created, batch.json().recognitionId)
    expect(transcription.shelfmark).toEqual(batchShelfmark)
    const [row] = await database.db.select().from(documents)
    expect([row?.yearFrom, row?.yearTo]).toEqual([1896, 1896])
    await created.app.close()
  })

  it('answers 401 for an unknown key before reading the body', async () => {
    const { app } = await createTestApp(database)
    const res = await send(app, { not: 'a recognition' }, 'khr_unknown')
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('limits lookups of unknown keys from one address', async () => {
    const { app } = await createTestApp(database)
    const statuses: number[] = []
    for (let i = 0; i <= apiKeyLookupsPerMinute + 1; i += 1) {
      statuses.push((await send(app, {}, `khr_unknown${i}`)).statusCode)
    }
    expect(statuses.slice(0, apiKeyLookupsPerMinute)).toEqual(
      Array(apiKeyLookupsPerMinute).fill(401),
    )
    expect(statuses.slice(apiKeyLookupsPerMinute)).toEqual([429, 429])
    await app.close()
  })

  it('limits a parallel burst of unknown keys too', async () => {
    const { app } = await createTestApp(database)
    const answers = await Promise.all(
      Array.from({ length: 30 }, (_, i) => send(app, {}, `khr_burst${i}`)),
    )
    const statuses = answers.map((res) => res.statusCode)
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true)
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(
      apiKeyLookupsPerMinute,
    )
    await app.close()
  })

  it('still accepts a key that was used before unknown keys from the same address', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    expect((await send(created.app, recognitionBody(nextPng()), key)).statusCode).toBe(201)
    for (let i = 0; i <= apiKeyLookupsPerMinute; i += 1) await send(created.app, {}, `khr_x${i}`)
    expect((await send(created.app, recognitionBody(nextPng()), key)).statusCode).toBe(201)
    await created.queue.onIdle()
    await created.app.close()
  })

  it('keeps a region on its page when a key reads it again under another shelfmark', async () => {
    const key = await createApiKey(database.db, 'batch')
    const failed = await createTestApp(database, { reader: failingReader('unreadable') })
    const png = nextPng()
    const guest = await send(
      failed.app,
      recognitionBody(png, { shelfmark: { ...sprava, image: 1 } }),
    )
    await failed.queue.onIdle()
    expect(guest.statusCode).toBe(201)
    await failed.app.close()

    const created = await createTestApp(database)
    const other = { ...batchShelfmark, sprava: '999', image: 7 }
    const batch = await send(
      created.app,
      recognitionBody(png, { shelfmark: other, source: 'batch', document }),
      key,
    )
    expect(batch.statusCode).toBe(201)
    expect(await database.db.select().from(documents)).toHaveLength(1)
    expect(await database.db.select().from(pages)).toHaveLength(1)
    await created.queue.onIdle()
    await created.app.close()
  })

  it('allows three active recognitions per key', async () => {
    const key = await createApiKey(database.db, 'batch')
    const recorder = createRecordingReader({ gated: true })
    const created = await createTestApp(database, { reader: recorder.reader })
    const statuses = []
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await send(created.app, recognitionBody(nextPng()), key)).statusCode)
    }
    expect(statuses).toEqual([201, 201, 201, 429])
    expect((await send(created.app, recognitionBody(nextPng()))).statusCode).toBe(201)
    recorder.release()
    await created.queue.onIdle()
    await created.app.close()
  })

  it('keeps the page when its folio already belongs to another page of the file', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    const guest = await send(
      created.app,
      recognitionBody(nextPng(), { shelfmark: { ...sprava, folio: '3зв' } }),
    )
    await transcriptionOf(created, guest.json().recognitionId)
    const batch = await send(
      created.app,
      recognitionBody(nextPng(), { shelfmark: batchShelfmark, source: 'batch', document }),
      key,
    )
    expect(batch.statusCode).toBe(201)
    const transcription = await transcriptionOf(created, batch.json().recognitionId)
    expect(transcription.shelfmark).toEqual({
      ...sprava,
      image: 4,
      portal: 'archium',
      portalUrl,
    })
    await created.app.close()
  })

  it('writes no other sheet when a key sends a read fragment under another shelfmark', async () => {
    const key = await createApiKey(database.db, 'batch')
    const created = await createTestApp(database)
    const png = nextPng()
    const guest = await send(
      created.app,
      recognitionBody(png, { shelfmark: { ...sprava, image: 1 } }),
    )
    await transcriptionOf(created, guest.json().recognitionId)
    const other = { ...batchShelfmark, sprava: '999', image: 7 }
    const batch = await send(
      created.app,
      recognitionBody(png, { shelfmark: other, source: 'batch', document }),
      key,
    )
    expect(batch.json().status).toBe('cached')
    expect(await database.db.select().from(documents)).toHaveLength(1)
    expect(await database.db.select().from(pages)).toHaveLength(1)
    await created.app.close()
  })

  it('keeps the metadata of a key while the same fragment is still being read', async () => {
    const key = await createApiKey(database.db, 'batch')
    const recorder = createRecordingReader({ gated: true })
    const created = await createTestApp(database, { reader: recorder.reader })
    const png = nextPng()
    const guest = await send(
      created.app,
      recognitionBody(png, { shelfmark: { ...sprava, image: 4 } }),
    )
    const batch = await send(
      created.app,
      recognitionBody(png, { shelfmark: batchShelfmark, source: 'batch', document }),
      key,
    )
    expect(batch.json()).toEqual({ recognitionId: guest.json().recognitionId, status: 'queued' })
    recorder.release()
    const transcription = await transcriptionOf(created, guest.json().recognitionId)
    expect(transcription.shelfmark).toEqual(batchShelfmark)
    await created.app.close()
  })

  it('stops unknown keys before the database once the lookups are spent', async () => {
    const broken = await createTestDatabase()
    await broken.client.close()
    const { app } = await createTestApp(broken)
    const statuses = []
    for (let i = 0; i <= apiKeyLookupsPerMinute; i += 1) {
      statuses.push((await send(app, {}, `khr_closed${i}`)).statusCode)
    }
    expect(statuses).toEqual([...Array(apiKeyLookupsPerMinute).fill(500), 429])
    await app.close()
  })

  it('adds the metadata to the page of a region whose reading failed', async () => {
    const key = await createApiKey(database.db, 'batch')
    const failed = await createTestApp(database, { reader: failingReader('unreadable') })
    const png = nextPng()
    await send(failed.app, recognitionBody(png, { shelfmark: { ...sprava, image: 4 } }))
    await failed.queue.onIdle()
    await failed.app.close()

    const created = await createTestApp(database)
    const batch = await send(
      created.app,
      recognitionBody(png, { shelfmark: batchShelfmark, source: 'batch', document }),
      key,
    )
    const transcription = await transcriptionOf(created, batch.json().recognitionId)
    expect(transcription.shelfmark).toEqual(batchShelfmark)
    await created.app.close()
  })

  it('answers 400 for a portal link with a control character', async () => {
    const key = await createApiKey(database.db, 'batch')
    const { app } = await createTestApp(database)
    const res = await send(
      app,
      recognitionBody(nextPng(), {
        shelfmark: { ...batchShelfmark, portalUrl: 'https://example.org/a\u0000b' },
        source: 'batch',
      }),
      key,
    )
    expect(res.statusCode).toBe(400)
    expect(await database.db.select().from(documents)).toHaveLength(0)
    await app.close()
  })
})

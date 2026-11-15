import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  chunks,
  modelCalls,
  recognitions,
  regions,
  sources,
  synonyms,
  transcriptions,
} from '../src/db/schema.ts'
import { utcDay } from '../src/services/budget.ts'
import {
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  type TestDatabase,
} from './helpers.ts'

const adminApiKey = 'k'.repeat(40)
const authorization = `Bearer ${adminApiKey}`

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

type App = Awaited<ReturnType<typeof createTestApp>>['app']

const adminApp = async () => (await createTestApp(database, { adminApiKey })).app

const post = (app: App, url: string, payload: object, key = authorization) =>
  app.inject({ method: 'POST', url, payload, headers: { authorization: key } })

const source = (url: string, title = 'Словник') => ({
  url,
  title,
  licence: 'суспільне надбання',
  kind: 'dictionary',
  periodFrom: 18,
  periodTo: 19,
})

const chunk = (sourceId: string, articleKey: string, idx: number, text: string) => ({
  articleKey,
  idx,
  sourceId,
  text,
  topic: articleKey,
  type: 'term',
  periodFrom: 18,
  periodTo: 19,
})

const createSource = async (app: App) => {
  const res = await post(app, '/v1/admin/sources', {
    items: [source('https://example.org/slovnyk')],
  })
  return res.json().items[0].id as string
}

describe('admin key', () => {
  it('answers 401 without the key or with a wrong one', async () => {
    const app = await adminApp()
    const items = { items: [source('https://example.org/a')] }
    const missing = await app.inject({ method: 'POST', url: '/v1/admin/sources', payload: items })
    expect(missing.statusCode).toBe(401)
    expect(missing.json().error.code).toBe('unauthorized')
    expect((await post(app, '/v1/admin/sources', items, 'Bearer wrong')).statusCode).toBe(401)
    const stats = await app.inject({ method: 'GET', url: '/v1/admin/stats' })
    expect(stats.statusCode).toBe(401)
    expect(await database.db.select().from(sources)).toHaveLength(0)
    await app.close()
  })

  it('has no admin routes without a key', async () => {
    const { app } = await createTestApp(database)
    const res = await post(app, '/v1/admin/sources', { items: [source('https://example.org/a')] })
    expect(res.statusCode).toBe(404)
    await app.close()
  })
})

describe('POST /v1/admin/sources', () => {
  it('keeps one source per url and returns the same id on a repeat', async () => {
    const app = await adminApp()
    const first = await post(app, '/v1/admin/sources', {
      items: [source('https://example.org/a'), source('https://example.org/b')],
    })
    expect(first.statusCode).toBe(200)
    const again = await post(app, '/v1/admin/sources', {
      items: [source('https://example.org/a', 'Словник, друге видання')],
    })
    const [firstA] = first.json().items
    expect(again.json().items).toEqual([firstA])
    const rows = await database.db.select().from(sources).where(eq(sources.id, firstA.id))
    expect(rows[0]?.title).toBe('Словник, друге видання')
    await app.close()
  })

  it('accepts the same source named by several articles', async () => {
    const app = await adminApp()
    const res = await post(app, '/v1/admin/sources', {
      items: [source('https://example.org/a'), source('https://example.org/a')],
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().items).toHaveLength(1)
    await app.close()
  })
})

describe('POST /v1/admin/chunks', () => {
  it('changes nothing when the same corpus is ingested again', async () => {
    const app = await adminApp()
    const sourceId = await createSource(app)
    const items = [
      chunk(sourceId, 'kum', 0, 'Кум — хрещений батько.'),
      chunk(sourceId, 'kum', 1, 'Друга частина статті.'),
    ]
    const first = await post(app, '/v1/admin/chunks', { items })
    expect(first.json()).toEqual({ inserted: 2, updated: 0, unchanged: 0, deleted: 0 })
    const before = await database.db.select().from(chunks)
    const again = await post(app, '/v1/admin/chunks', { items })
    expect(again.json()).toEqual({ inserted: 0, updated: 0, unchanged: 2, deleted: 0 })
    expect(await database.db.select().from(chunks)).toEqual(before)
    await app.close()
  })

  it('leaves exactly the chunks of a corrected article and removes the rest', async () => {
    const app = await adminApp()
    const sourceId = await createSource(app)
    await post(app, '/v1/admin/chunks', {
      items: [
        chunk(sourceId, 'kum', 0, 'Кум — хрещений батько.'),
        chunk(sourceId, 'kum', 1, 'Стара друга частина.'),
        { ...chunk(sourceId, 'borshchahivka', 0, 'Борщагівка — село.'), type: 'place' },
      ],
    })
    const corrected = await post(app, '/v1/admin/chunks', {
      items: [
        chunk(sourceId, 'kum', 0, 'Кум — хрещений батько дитини.'),
        {
          ...chunk(sourceId, 'borshchahivka', 0, 'Борщагівка — село.'),
          type: 'place',
          wikidataId: 'Q4535404',
        },
      ],
    })
    expect(corrected.json()).toEqual({ inserted: 0, updated: 2, unchanged: 0, deleted: 1 })
    const rows = await database.db.select().from(chunks)
    expect(rows.map((row) => [row.articleKey, row.idx, row.text, row.wikidataId]).sort()).toEqual([
      ['borshchahivka', 0, 'Борщагівка — село.', 'Q4535404'],
      ['kum', 0, 'Кум — хрещений батько дитини.', null],
    ])
    await app.close()
  })

  it('answers 400 for a chunk of an unknown source and writes nothing', async () => {
    const app = await adminApp()
    const res = await post(app, '/v1/admin/chunks', {
      items: [chunk('0190a000-0000-7000-8000-000000000000', 'kum', 0, 'Кум — хрещений батько.')],
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    expect(await database.db.select().from(chunks)).toHaveLength(0)
    await app.close()
  })
})

describe('POST /v1/admin/synonyms', () => {
  it('inserts new pairs, updates a changed type and keeps the rest', async () => {
    const app = await adminApp()
    const first = await post(app, '/v1/admin/synonyms', {
      items: [
        { term: 'кум', variant: 'кумъ', type: 'term' },
        { term: 'кум', variant: 'восприемник', type: 'term' },
      ],
    })
    expect(first.json()).toEqual({ inserted: 2, updated: 0, unchanged: 0 })
    const again = await post(app, '/v1/admin/synonyms', {
      items: [
        { term: 'кум', variant: 'кумъ', type: 'term' },
        { term: 'кум', variant: 'восприемник', type: 'abbr' },
        { term: 'Борщагівка', variant: 'Борщаговка', type: 'place' },
      ],
    })
    expect(again.json()).toEqual({ inserted: 1, updated: 1, unchanged: 1 })
    expect(await database.db.select().from(synonyms)).toHaveLength(3)
    await app.close()
  })
})

describe('GET /v1/admin/stats', () => {
  it('counts readings without cache answers, verified pages and model calls', async () => {
    const { app, queue } = await createTestApp(database, { adminApiKey })
    const png = makePng(321, 200)
    const shelfmark = { archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: '1954', image: 4 }
    await app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(png, { shelfmark }),
    })
    await queue.onIdle()
    const cached = await app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(png, { shelfmark }),
    })
    expect(cached.json().status).toBe('cached')

    const [region] = await database.db.select().from(regions)
    if (!region) throw new Error('region was not created')
    await database.db
      .insert(recognitions)
      .values({ regionId: region.id, source: 'web', status: 'failed' })
    await database.db
      .update(transcriptions)
      .set({ status: 'verified', verifiedAt: new Date() })
      .where(eq(transcriptions.regionId, region.id))
    await database.db.insert(modelCalls).values({ day: utcDay(), calls: 7 })

    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization },
    })
    expect(res.statusCode).toBe(200)
    const stats = res.json()
    expect(stats.recognitions.total).toBe(2)
    expect(stats.recognitions.failed).toBe(1)
    expect(stats.recognitions.p95Ms).toBeGreaterThanOrEqual(0)
    expect(stats.verifiedPages).toBe(1)
    expect(stats.modelCalls).toEqual({ today: 7, limit: 2000 })
    await app.close()
  })

  it('reports no time while nothing was read', async () => {
    const app = await adminApp()
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/stats',
      headers: { authorization },
    })
    expect(res.json()).toEqual({
      recognitions: { total: 0, failed: 0, p95Ms: null },
      verifiedPages: 0,
      modelCalls: { today: 0, limit: 2000 },
    })
    await app.close()
  })
})

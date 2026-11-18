import { recentResponseSchema } from '@khronist/contracts'
import { eq, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documents, pages, regions, transcriptions } from '../src/db/schema.ts'
import { searchesPerMinute } from '../src/lib/limits.ts'
import { decodeRecentCursor, encodeRecentCursor } from '../src/services/recent.ts'
import { insertTranscriptionVersion } from '../src/services/transcriptions.ts'
import {
  createTestApp,
  createTestDatabase,
  linesOf,
  resetDatabase,
  type TestDatabase,
} from './helpers.ts'

let database: TestDatabase
let app: Awaited<ReturnType<typeof createTestApp>>['app']

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

beforeEach(async () => {
  await resetDatabase(database)
  app = (await createTestApp(database)).app
  return () => app.close()
})

const only = <T>(rows: T[]): T => {
  const [row] = rows
  if (row === undefined) throw new Error('no row was returned')
  return row
}

type Sheet = { years?: [number, number]; sourceUrl?: string }

let sheets = 0

const addRegion = async (sheet: Sheet | null = {}) => {
  sheets += 1
  let pageId: string | null = null
  if (sheet) {
    const document = only(
      await database.db
        .insert(documents)
        .values({
          archive: 'ЦДІАК України',
          fond: '127',
          opys: '1078',
          sprava: String(sheets),
          yearFrom: sheet.years?.[0] ?? null,
          yearTo: sheet.years?.[1] ?? null,
        })
        .returning({ id: documents.id }),
    )
    const page = only(
      await database.db
        .insert(pages)
        .values({ documentId: document.id, imageNo: 4, sourceUrl: sheet.sourceUrl ?? null })
        .returning({ id: pages.id }),
    )
    pageId = page.id
  }
  const region = only(
    await database.db
      .insert(regions)
      .values({ pageId, x: 0, y: 0, w: 1, h: 1, imageHash: `hash-${sheets}` })
      .returning({ id: regions.id }),
  )
  return region.id
}

const addVersion = (regionId: string, text: string) =>
  insertTranscriptionVersion(database.db, {
    regionId,
    reader: 'fixture',
    lines: linesOf(text),
    warnings: [],
    normalized: null,
    translatedLines: null,
    entities: [],
  })

const verify = (transcriptionId: string, verifiedAt: string) =>
  database.db
    .update(transcriptions)
    .set({ status: 'verified', verifiedAt: new Date(verifiedAt) })
    .where(eq(transcriptions.id, transcriptionId))

const addVerified = async (text: string, verifiedAt: string, sheet: Sheet | null = {}) => {
  const id = await addVersion(await addRegion(sheet), text)
  await verify(id, verifiedAt)
  return id
}

const recent = (params: Record<string, string> = {}) =>
  app.inject({
    method: 'GET',
    url: `/v1/transcriptions/recent?${new URLSearchParams(params).toString()}`,
  })

const recentIds = async (params: Record<string, string> = {}) => {
  const res = await recent(params)
  expect(res.statusCode).toBe(200)
  return recentResponseSchema.parse(res.json()).items.map((item) => item.transcriptionId)
}

describe('GET /v1/transcriptions/recent', () => {
  it('describes a verified record by the contract', async () => {
    const id = await addVerified(
      'Села Борщаговки крестьянин\nІван Петров Коваленко',
      '2026-11-18T10:00:00.000Z',
      { years: [1884, 1884], sourceUrl: 'https://archium.cdiak.archives.gov.ua/file-viewer/1' },
    )

    const res = await recent()
    expect(res.statusCode).toBe(200)
    expect(recentResponseSchema.safeParse(res.json()).success).toBe(true)
    expect(res.json()).toEqual({
      items: [
        {
          transcriptionId: id,
          shelfmark: {
            archive: 'ЦДІАК України',
            fond: '127',
            opys: '1078',
            sprava: String(sheets),
            image: 4,
            portalUrl: 'https://archium.cdiak.archives.gov.ua/file-viewer/1',
          },
          yearFrom: 1884,
          yearTo: 1884,
          snippet: 'Села Борщаговки крестьянин Іван Петров Коваленко',
          status: 'verified',
          portalUrl: 'https://archium.cdiak.archives.gov.ua/file-viewer/1',
          verifiedAt: '2026-11-18T10:00:00.000Z',
        },
      ],
    })
  })

  it('leaves out years and the portal link that the sheet does not have', async () => {
    await addVerified('Коваленко', '2026-11-18T10:00:00.000Z')
    const [item] = (await recent()).json().items
    expect(Object.keys(item).sort()).toEqual([
      'shelfmark',
      'snippet',
      'status',
      'transcriptionId',
      'verifiedAt',
    ])
  })

  it('answers without items when nothing is verified', async () => {
    await addVersion(await addRegion(), 'Чернетка')
    expect((await recent()).json()).toEqual({ items: [] })
  })

  it('puts the latest verification first', async () => {
    const older = await addVerified('Перший', '2026-11-18T09:00:00.000Z')
    const newer = await addVerified('Другий', '2026-11-18T11:00:00.000Z')
    const middle = await addVerified('Третій', '2026-11-18T10:00:00.000Z')
    expect(await recentIds()).toEqual([newer, middle, older])
  })

  it('leaves out drafts and disputed versions', async () => {
    const shown = await addVerified('Підтверджений', '2026-11-18T10:00:00.000Z')
    await addVersion(await addRegion(), 'Чернетка')
    const disputed = await addVersion(await addRegion(), 'Спірний')
    await database.db
      .update(transcriptions)
      .set({ status: 'disputed' })
      .where(eq(transcriptions.id, disputed))
    expect(await recentIds()).toEqual([shown])
  })

  it('leaves out regions without a sheet', async () => {
    await addVerified('Без аркуша', '2026-11-18T10:00:00.000Z', null)
    expect(await recentIds()).toEqual([])
  })

  describe('one version per region', () => {
    it('shows the latest verified version of a region', async () => {
      const regionId = await addRegion()
      const first = await addVersion(regionId, 'Перша')
      await verify(first, '2026-11-18T09:00:00.000Z')
      const second = await addVersion(regionId, 'Друга')
      await verify(second, '2026-11-18T08:00:00.000Z')
      expect(await recentIds()).toEqual([second])
    })

    it('keeps the verified version when a newer draft follows it', async () => {
      const regionId = await addRegion()
      const verified = await addVersion(regionId, 'Підтверджена')
      await verify(verified, '2026-11-18T09:00:00.000Z')
      await addVersion(regionId, 'Нова чернетка')
      expect(await recentIds()).toEqual([verified])
    })
  })

  it('makes a one-line snippet of at most 200 characters from the start of the text', async () => {
    const words = Array.from({ length: 80 }, (_, index) => `слово${index}`)
    await addVerified(
      `  ${words.slice(0, 40).join('\n')}\n${words.slice(40).join(' ')}`,
      '2026-11-18T10:00:00.000Z',
    )
    const [item] = (await recent()).json().items
    expect(item.snippet).not.toMatch(/\s{2}|\n/u)
    expect(item.snippet.startsWith('слово0 слово1 ')).toBe(true)
    expect([...item.snippet]).toHaveLength(200)
  })

  it('does not end the snippet with the space where it was cut', async () => {
    await addVerified(`${'а'.repeat(199)} ${'б'.repeat(20)}`, '2026-11-18T10:00:00.000Z')
    const [item] = (await recent()).json().items
    expect(item.snippet).toBe('а'.repeat(199))
  })

  describe('pages', () => {
    it('walks all records with the cursor without repeats, ties broken by id', async () => {
      const same = '2026-11-18T10:00:00.000Z'
      for (const at of [same, '2026-11-18T12:00:00.000Z', same, '2026-11-18T08:00:00.000Z', same]) {
        await addVerified('Запис', at)
      }
      const all = await recentIds()
      expect(all).toHaveLength(5)

      const walked: string[] = []
      const pageSizes: number[] = []
      let cursor: string | undefined
      do {
        const res = await recent({ limit: '2', ...(cursor && { cursor }) })
        expect(res.statusCode).toBe(200)
        const body = recentResponseSchema.parse(res.json())
        pageSizes.push(body.items.length)
        walked.push(...body.items.map((item) => item.transcriptionId))
        cursor = body.nextCursor
      } while (cursor)
      expect(pageSizes).toEqual([2, 2, 1])
      expect(walked).toEqual(all)
    })

    it('pages through verification times finer than a millisecond', async () => {
      const times = [
        '2026-11-18T10:00:00.123455Z',
        '2026-11-18T10:00:00.123457Z',
        '2026-11-18T10:00:00.123456Z',
      ]
      const ids: string[] = []
      for (const at of times) {
        const id = await addVerified('Запис', '2026-11-18T10:00:00.000Z')
        await database.db.execute(
          sql`update transcriptions set verified_at = ${at}::timestamptz where id = ${id}`,
        )
        ids.push(id)
      }
      const walked: string[] = []
      let cursor: string | undefined
      do {
        const body = recentResponseSchema.parse(
          (await recent({ limit: '1', ...(cursor && { cursor }) })).json(),
        )
        walked.push(...body.items.map((item) => item.transcriptionId))
        cursor = body.nextCursor
      } while (cursor)
      expect(walked).toEqual([ids[1], ids[2], ids[0]])
    })

    it('treats an empty cursor as the first page', async () => {
      await addVerified('Запис', '2026-11-18T10:00:00.000Z')
      const empty = await recent({ cursor: '' })
      expect(empty.statusCode).toBe(200)
      expect(empty.json()).toEqual((await recent()).json())
    })

    it('gives no cursor when the page holds the last record', async () => {
      await addVerified('Запис', '2026-11-18T10:00:00.000Z')
      await addVerified('Запис', '2026-11-18T11:00:00.000Z')
      const res = await recent({ limit: '2' })
      expect(res.json().items).toHaveLength(2)
      expect(res.json().nextCursor).toBeUndefined()
    })

    it('returns twenty records by default', async () => {
      for (let i = 0; i < 21; i += 1) await addVerified('Запис', '2026-11-18T10:00:00.000Z')
      const res = await recent()
      expect(res.json().items).toHaveLength(20)
      expect(res.json().nextCursor).toEqual(expect.any(String))
    })
  })

  it.each([
    ['a limit of zero', { limit: '0' }],
    ['a limit above fifty', { limit: '51' }],
    ['a fractional limit', { limit: '2.5' }],
    ['a limit that is not a number', { limit: 'багато' }],
    ['an empty limit', { limit: '' }],
    ['a cursor that is not ours', { cursor: 'not-a-cursor' }],
    [
      'a cursor of another shape',
      { cursor: Buffer.from('{"rank":1,"id":"x"}').toString('base64url') },
    ],
    [
      'a cursor with an impossible date',
      {
        cursor: Buffer.from(
          '{"at":"2026-02-30T10:00:00.000000Z","id":"0190a000-0000-7000-8000-000000000000"}',
        ).toString('base64url'),
      },
    ],
  ])('answers 400 for %s', async (_case, params) => {
    const res = await recent(params)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    expect(res.json().error.message).toEqual(expect.any(String))
  })

  it(`allows ${searchesPerMinute} requests a minute from one address`, async () => {
    for (let i = 0; i < searchesPerMinute; i += 1) {
      expect((await recent()).statusCode).toBe(200)
    }
    const limited = await recent()
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    expect(limited.headers['retry-after']).toBeDefined()
  })
})

describe('recent cursor', () => {
  const id = '0190a000-0000-7000-8000-000000000000'

  it.each(['2026-11-18T10:00:00.123456Z', '2026-11-18T10:00:00.000000Z'])(
    'keeps the time %s exactly',
    (at) => {
      expect(decodeRecentCursor(encodeRecentCursor({ at, id }))).toEqual({ at, id })
    },
  )

  it.each([
    ['not base64 JSON', 'abc'],
    ['no id', Buffer.from('{"at":"2026-11-18T10:00:00.000000Z"}').toString('base64url')],
    [
      'a time without microseconds',
      Buffer.from(`{"at":"2026-11-18T10:00:00Z","id":"${id}"}`).toString('base64url'),
    ],
    ['a time that is not a time', Buffer.from(`{"at":"вчора","id":"${id}"}`).toString('base64url')],
    ['a time in a number', Buffer.from(`{"at":1,"id":"${id}"}`).toString('base64url')],
    ...[
      '2026-02-30T10:00:00.000000Z',
      '2026-13-45T10:00:00.000000Z',
      '2026-11-18T24:00:00.000000Z',
      '0000-01-01T00:00:00.000000Z',
    ].map((at) => [
      `the impossible time ${at}`,
      Buffer.from(JSON.stringify({ at, id })).toString('base64url'),
    ]),
  ])('rejects %s', (_case, value) => {
    expect(() => decodeRecentCursor(value)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'bad_request' }),
    )
  })
})

import {
  maxSearchQueryLength,
  searchResponseSchema,
  type Entity,
  type Line,
} from '@khronist/contracts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { documents, pages, regions, synonyms, transcriptions } from '../src/db/schema.ts'
import { searchesPerMinute } from '../src/lib/limits.ts'
import { decodeCursor, encodeCursor } from '../src/services/search.ts'
import { insertTranscriptionVersion } from '../src/services/transcriptions.ts'
import { createTestApp, createTestDatabase, resetDatabase, type TestDatabase } from './helpers.ts'

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

type Sheet = {
  archive?: string
  fond?: string
  years?: [number, number]
  sourceUrl?: string
}

let sheets = 0

const addRegion = async (sheet: Sheet | null = {}) => {
  sheets += 1
  let pageId: string | null = null
  if (sheet) {
    const document = only(
      await database.db
        .insert(documents)
        .values({
          archive: sheet.archive ?? 'ЦДІАК України',
          fond: sheet.fond ?? '127',
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

const linesOf = (text: string): Line[] =>
  text.split('\n').map((line, idx, all) => ({
    idx,
    text: line,
    box: { x: 0, y: idx / all.length, w: 1, h: 1 / all.length },
    boxSource: 'estimated',
    uncertain: false,
    words: line.split(' ').map((word) => ({ text: word, uncertain: false })),
  }))

const addVersion = (regionId: string, text: string, found: Entity[] = []) =>
  insertTranscriptionVersion(database.db, {
    regionId,
    reader: 'fixture',
    lines: linesOf(text),
    warnings: [],
    normalized: null,
    translatedLines: null,
    entities: found,
  })

const addTranscription = async (text: string, sheet: Sheet | null = {}) =>
  addVersion(await addRegion(sheet), text)

const verify = (transcriptionId: string) =>
  database.db
    .update(transcriptions)
    .set({ status: 'verified', verifiedAt: new Date() })
    .where(eq(transcriptions.id, transcriptionId))

const search = (params: Record<string, string> | URLSearchParams) =>
  app.inject({ method: 'GET', url: `/v1/search?${new URLSearchParams(params).toString()}` })

const foundIds = async (params: Record<string, string>) => {
  const res = await search(params)
  expect(res.statusCode).toBe(200)
  return searchResponseSchema.parse(res.json()).items.map((item) => item.transcriptionId)
}

describe('GET /v1/search', () => {
  it('finds a sheet by a word of its text and describes it by the contract', async () => {
    const id = await addTranscription('Села Борщаговки крестьянин\nІван Петров Коваленко', {
      years: [1850, 1859],
      sourceUrl: 'https://archium.archives.gov.ua/scan/4',
    })
    await addTranscription('Інший аркуш без цього прізвища')

    const res = await search({ q: 'Коваленко' })
    expect(res.statusCode).toBe(200)
    expect(searchResponseSchema.safeParse(res.json()).success).toBe(true)
    expect(res.json()).toEqual({
      items: [
        {
          transcriptionId: id,
          shelfmark: {
            archive: 'ЦДІАК України',
            fond: '127',
            opys: '1078',
            sprava: String(sheets - 1),
            image: 4,
            portalUrl: 'https://archium.archives.gov.ua/scan/4',
          },
          yearFrom: 1850,
          yearTo: 1859,
          snippet: 'Села Борщаговки крестьянин Іван Петров Коваленко',
          status: 'draft',
          portalUrl: 'https://archium.archives.gov.ua/scan/4',
        },
      ],
    })
  })

  it('leaves out years and the portal link that the sheet does not have', async () => {
    await addTranscription('Коваленко')
    const [item] = (await search({ q: 'Коваленко' })).json().items
    expect(Object.keys(item).sort()).toEqual(['shelfmark', 'snippet', 'status', 'transcriptionId'])
  })

  it('answers without items when nothing matches', async () => {
    await addTranscription('Коваленко')
    expect((await search({ q: 'Пилипенко' })).json()).toEqual({ items: [] })
  })

  it.each([
    ['upper case', 'КОВАЛЕНКО', 'Іван Коваленко'],
    ['a typographic apostrophe in the text', "Мар'яна", 'Мар’яна Коваленко'],
    ['a modifier apostrophe in the text', 'мар’яна', 'Марʼяна Коваленко'],
    ['a stress mark in the query', 'Кова́ленко', 'Іван Коваленко'],
    ['letters of the old orthography', 'ИСПОВѢДАНІЯ', 'оба православнаго исповѣданія'],
  ])('finds a word written in %s', async (_case, q, text) => {
    const id = await addTranscription(text)
    expect(await foundIds({ q })).toEqual([id])
  })

  it.each([
    ['only common words and numbers', 'що на 12'],
    ['only punctuation', '«» — !!'],
  ])('answers without items for a query of %s', async (_case, q) => {
    await addTranscription('що на 12 Коваленко')
    expect((await search({ q })).json()).toEqual({ items: [] })
  })

  it('finds other spellings from the dictionary of variants', async () => {
    const id = await addTranscription('Села Борщаговка крестьянин')
    expect(await foundIds({ q: 'Борщагівка' })).toEqual([])
    await database.db
      .insert(synonyms)
      .values({ term: 'Борщаговка', variant: 'Борщагівка', type: 'place' })
    expect(await foundIds({ q: 'Борщагівка' })).toEqual([id])
  })

  it('finds a name spelled a little differently among the people of the record', async () => {
    const regionId = await addRegion()
    const text = 'Позов Івана Коваленка про землю'
    const start = text.indexOf('Івана')
    const id = await addVersion(regionId, text, [
      {
        type: 'person',
        text: 'Івана Коваленка',
        start,
        end: start + 'Івана Коваленка'.length,
        normalized: 'Іван Коваленко',
      },
    ])
    await addTranscription('Позов Петра Шевченка про землю')
    expect(await foundIds({ q: 'Коваленков' })).toEqual([id])
  })

  it('puts the sheet that matches more of the query first', async () => {
    const one = await addTranscription('Коваленко з іншого села')
    const both = await addTranscription('Коваленко з села Борщаговка')
    expect(await foundIds({ q: 'Коваленко Борщаговка' })).toEqual([both, one])
  })

  it('puts a sheet that names the person above one that only mentions the word', async () => {
    const mention = await addTranscription('Коваленко Коваленко Коваленко')
    const regionId = await addRegion()
    const named = await addVersion(regionId, 'Коваленко', [
      { type: 'person', text: 'Коваленко', start: 0, end: 9, normalized: 'Коваленко' },
    ])
    expect(await foundIds({ q: 'Коваленко' })).toEqual([named, mention])
  })

  it('leaves out regions without a sheet', async () => {
    await addTranscription('Коваленко', null)
    const withSheet = await addTranscription('Коваленко')
    expect(await foundIds({ q: 'Коваленко' })).toEqual([withSheet])
  })

  describe('one version per region', () => {
    it('takes the latest version when none is verified', async () => {
      const regionId = await addRegion()
      await addVersion(regionId, 'Коваленко')
      const latest = await addVersion(regionId, 'Коваленко Іван')
      expect(await foundIds({ q: 'Коваленко' })).toEqual([latest])
    })

    it('takes the latest verified version over a newer draft', async () => {
      const regionId = await addRegion()
      await verify(await addVersion(regionId, 'Коваленко'))
      const verified = await addVersion(regionId, 'Коваленко Іван')
      await verify(verified)
      await addVersion(regionId, 'Коваленко Іван Петрович')
      const res = await search({ q: 'Коваленко' })
      expect(res.json().items).toEqual([
        expect.objectContaining({ transcriptionId: verified, status: 'verified' }),
      ])
    })

    it('does not find a region by a word of a version that is not shown', async () => {
      const regionId = await addRegion()
      await addVersion(regionId, 'Пилипенко')
      await addVersion(regionId, 'Коваленко')
      expect(await foundIds({ q: 'Пилипенко' })).toEqual([])
    })

    it('does not find a region by a newer draft when a verified version exists', async () => {
      const regionId = await addRegion()
      await verify(await addVersion(regionId, 'Коваленко'))
      await addVersion(regionId, 'Пилипенко')
      expect(await foundIds({ q: 'Пилипенко' })).toEqual([])
    })

    it('treats a disputed version as not verified', async () => {
      const regionId = await addRegion()
      const disputed = await addVersion(regionId, 'Коваленко')
      await database.db
        .update(transcriptions)
        .set({ status: 'disputed' })
        .where(eq(transcriptions.id, disputed))
      const latest = await addVersion(regionId, 'Коваленко Іван')
      expect(await foundIds({ q: 'Коваленко' })).toEqual([latest])
    })
  })

  it.each([
    ['true', ['verified']],
    ['1', ['verified']],
    ['false', ['draft', 'verified']],
  ])('with verifiedOnly=%s finds %j', async (verifiedOnly, expected) => {
    await addTranscription('Коваленко')
    await verify(await addTranscription('Коваленко'))
    const res = await search({ q: 'Коваленко', verifiedOnly })
    expect(res.statusCode).toBe(200)
    expect(
      res
        .json()
        .items.map((item: { status: string }) => item.status)
        .sort(),
    ).toEqual(expected)
  })

  it.each([
    [{ archive: 'ДАКО' }, ['ДАКО 1', 'ДАКО 2']],
    [{ fond: '2' }, ['ЦДІАК 2', 'ДАКО 2']],
    [{ archive: 'ДАКО', fond: '2' }, ['ДАКО 2']],
    [{ archive: 'ДАК' }, []],
    [{ archive: '' }, ['ЦДІАК 2', 'ДАКО 1', 'ДАКО 2']],
    [{ archive: '   ', fond: '' }, ['ЦДІАК 2', 'ДАКО 1', 'ДАКО 2']],
    [{ archive: ' ДАКО ' }, ['ДАКО 1', 'ДАКО 2']],
    [{ archive: 'ДАКО', fond: ' 2\t' }, ['ДАКО 2']],
  ])('filters by %j', async (filter, expected) => {
    const named = new Map<string, string>()
    for (const [archive, fond] of [
      ['ЦДІАК', '2'],
      ['ДАКО', '1'],
      ['ДАКО', '2'],
    ] as const) {
      named.set(await addTranscription('Коваленко', { archive, fond }), `${archive} ${fond}`)
    }
    const ids = await foundIds({ q: 'Коваленко', ...filter })
    expect(ids.map((id) => named.get(id)).sort()).toEqual([...expected].sort())
  })

  it.each([
    [{}, ['1850–1859', '1700–2000', 'без років']],
    [{ yearFrom: '1855' }, ['1850–1859', '1700–2000']],
    [{ yearFrom: '1859' }, ['1850–1859', '1700–2000']],
    [{ yearFrom: '1860' }, ['1700–2000']],
    [{ yearTo: '1850' }, ['1850–1859', '1700–2000']],
    [{ yearTo: '1849' }, ['1700–2000']],
    [{ yearFrom: '2001' }, []],
    [{ yearFrom: '1800', yearTo: '1900' }, ['1850–1859', '1700–2000']],
    [{ yearFrom: '1852', yearTo: '1853' }, ['1850–1859', '1700–2000']],
    [{ yearFrom: '1860', yearTo: '1900' }, ['1700–2000']],
    [{ yearFrom: '1855', yearTo: '1855' }, ['1850–1859', '1700–2000']],
    [{ yearFrom: '1856', yearTo: '1854' }, []],
    [{ yearFrom: '1900', yearTo: '1800' }, []],
  ])('filters years by %j as an overlap', async (filter, expected) => {
    const named = new Map<string, string>([
      [await addTranscription('Коваленко', { years: [1850, 1859] }), '1850–1859'],
      [await addTranscription('Коваленко', { years: [1700, 2000] }), '1700–2000'],
      [await addTranscription('Коваленко'), 'без років'],
    ])
    const ids = await foundIds({ q: 'Коваленко', ...filter })
    expect(ids.map((id) => named.get(id)).sort()).toEqual([...expected].sort())
  })

  describe('pages', () => {
    it('walks all results with the cursor in rank order without repeats', async () => {
      const texts = [
        'Коваленко',
        'Коваленко Коваленко',
        'Коваленко',
        'Коваленко Коваленко Коваленко',
        'Коваленко',
      ]
      for (const text of texts) await addTranscription(text)
      const all = await foundIds({ q: 'Коваленко' })
      expect(all).toHaveLength(5)

      const walked: string[] = []
      let cursor: string | undefined
      const pageSizes: number[] = []
      do {
        const res = await search({ q: 'Коваленко', limit: '2', ...(cursor && { cursor }) })
        expect(res.statusCode).toBe(200)
        const body = searchResponseSchema.parse(res.json())
        pageSizes.push(body.items.length)
        walked.push(...body.items.map((item) => item.transcriptionId))
        cursor = body.nextCursor
      } while (cursor)
      expect(pageSizes).toEqual([2, 2, 1])
      expect(walked).toEqual(all)
    })

    it('treats an empty cursor as the first page', async () => {
      await addTranscription('Коваленко')
      const first = await search({ q: 'Коваленко' })
      const empty = await search({ q: 'Коваленко', cursor: '' })
      expect(empty.statusCode).toBe(200)
      expect(empty.json()).toEqual(first.json())
      expect(empty.json().items).toHaveLength(1)
    })

    it('gives no cursor when the page holds the last result', async () => {
      await addTranscription('Коваленко')
      await addTranscription('Коваленко')
      const res = await search({ q: 'Коваленко', limit: '2' })
      expect(res.json().items).toHaveLength(2)
      expect(res.json().nextCursor).toBeUndefined()
    })

    it('returns twenty results by default', async () => {
      for (let i = 0; i < 21; i += 1) await addTranscription('Коваленко')
      const res = await search({ q: 'Коваленко' })
      expect(res.json().items).toHaveLength(20)
      expect(res.json().nextCursor).toEqual(expect.any(String))
    })
  })

  it('makes a one-line snippet around the match of a long text', async () => {
    const before = Array.from({ length: 60 }, (_, index) => `слово${index}`).join(' ')
    const after = Array.from({ length: 60 }, (_, index) => `інше${index}`).join('\n')
    await addTranscription(`${before}\nКоваленко\n${after}`)
    const [item] = (await search({ q: 'Коваленко' })).json().items
    expect(item.snippet).toContain('Коваленко')
    expect(item.snippet).not.toMatch(/[\n<>]/u)
    expect(item.snippet.split(' ').length).toBeLessThan(40)
  })

  it(`accepts a query of ${maxSearchQueryLength} characters`, async () => {
    const q = `Коваленко ${'а'.repeat(maxSearchQueryLength - 10)}`
    expect(q).toHaveLength(maxSearchQueryLength)
    expect((await search({ q })).statusCode).toBe(200)
  })

  it.each([
    ['no query', {}],
    ['an empty query', { q: '' }],
    ['a blank query', { q: '   ' }],
    ['a query that is too long', { q: 'а'.repeat(maxSearchQueryLength + 1) }],
    ['a limit of zero', { q: 'Коваленко', limit: '0' }],
    ['a limit above fifty', { q: 'Коваленко', limit: '51' }],
    ['a fractional limit', { q: 'Коваленко', limit: '2.5' }],
    ['a limit that is not a number', { q: 'Коваленко', limit: 'багато' }],
    ['a year before 1000', { q: 'Коваленко', yearFrom: '999' }],
    ['a year after 2100', { q: 'Коваленко', yearTo: '2101' }],
    ['a year that is not a number', { q: 'Коваленко', yearFrom: 'давно' }],
    ['an empty year', { q: 'Коваленко', yearFrom: '' }],
    ['an empty limit', { q: 'Коваленко', limit: '' }],
    ['an empty flag', { q: 'Коваленко', verifiedOnly: '' }],
    ['an unknown flag value', { q: 'Коваленко', verifiedOnly: 'maybe' }],
    ['a cursor that is not ours', { q: 'Коваленко', cursor: 'not-a-cursor' }],
    [
      'a cursor of another shape',
      { q: 'Коваленко', cursor: Buffer.from('{"rank":"1","id":"x"}').toString('base64url') },
    ],
  ])('answers 400 for %s', async (_case, params) => {
    const res = await search(params)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    expect(res.json().error.message).toEqual(expect.any(String))
  })

  it('answers 400 for a repeated filter', async () => {
    const params = new URLSearchParams({ q: 'Коваленко' })
    params.append('archive', 'ДАКО')
    params.append('archive', 'ЦДІАК')
    const res = await search(params)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
  })

  it(`allows ${searchesPerMinute} searches a minute from one address`, async () => {
    for (let i = 0; i < searchesPerMinute; i += 1) {
      expect((await search({ q: 'що' })).statusCode).toBe(200)
    }
    const limited = await search({ q: 'що' })
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    expect(limited.headers['retry-after']).toBeDefined()
  })
})

describe('search cursor', () => {
  const id = '0190a000-0000-7000-8000-000000000000'

  it.each([0, 0.0607927106320858, 1.9000000953674316, 1e-7])(
    'keeps the rank %d exactly',
    (rank) => {
      expect(decodeCursor(encodeCursor({ rank, id }))).toEqual({ rank, id })
    },
  )

  it.each([
    ['not base64 JSON', 'abc'],
    ['an empty string', ''],
    ['a list', Buffer.from('[1]').toString('base64url')],
    ['no id', Buffer.from('{"rank":1}').toString('base64url')],
    ['a rank in a string', Buffer.from(`{"rank":"1","id":"${id}"}`).toString('base64url')],
  ])('rejects %s', (_case, value) => {
    expect(() => decodeCursor(value)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'bad_request' }),
    )
  })
})

import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrationsFolder } from '../src/db/migrate.ts'
import {
  chunks,
  documents,
  edits,
  pages,
  recognitions,
  regions,
  sources,
  transcriptions,
} from '../src/db/schema.ts'

const hash = 'a'.repeat(64)

type PgViolation = { code: string; constraint: string | undefined }

const findViolation = (error: unknown): PgViolation | undefined => {
  let current: unknown = error
  while (current instanceof Error) {
    if ('code' in current && typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) {
      const constraint =
        'constraint' in current && typeof current.constraint === 'string'
          ? current.constraint
          : undefined
      return { code: current.code, constraint }
    }
    current = current.cause
  }
  return undefined
}

const expectViolation = async (promise: PromiseLike<unknown>, code: string, constraint?: string) => {
  const error = await Promise.resolve(promise).then(
    () => undefined,
    (e: unknown) => e ?? new Error('rejected without a reason'),
  )
  expect(error, 'statement should have been rejected').toBeDefined()
  const violation = findViolation(error)
  expect(violation?.code).toBe(code)
  if (constraint) expect(violation?.constraint).toBe(constraint)
}

describe('database schema', () => {
  const client = new PGlite({ extensions: { pg_trgm } })
  const db = drizzle(client)
  let counter = 0

  beforeAll(async () => {
    await migrate(db, { migrationsFolder })
  })

  afterAll(async () => {
    await client.close()
  })

  const makeDocument = async () => {
    counter += 1
    const [doc] = await db
      .insert(documents)
      .values({ archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: String(counter), portal: 'archium' })
      .returning()
    if (!doc) throw new Error('document not inserted')
    return doc
  }

  const makeRegion = async () => {
    const doc = await makeDocument()
    const [page] = await db.insert(pages).values({ documentId: doc.id, imageNo: 4 }).returning()
    if (!page) throw new Error('page not inserted')
    const [region] = await db
      .insert(regions)
      .values({ pageId: page.id, x: 0.1, y: 0.1, w: 0.5, h: 0.5, imageHash: hash })
      .returning()
    if (!region) throw new Error('region not inserted')
    return { doc, page, region }
  }

  describe('pages', () => {
    it('stores an ARCHIUM page by image number without a folio', async () => {
      const doc = await makeDocument()
      const [page] = await db.insert(pages).values({ documentId: doc.id, imageNo: 6 }).returning()
      expect(page?.folio).toBeNull()
      expect(page?.imageNo).toBe(6)
    })

    it('allows many pages with a null folio in one document', async () => {
      const doc = await makeDocument()
      await db.insert(pages).values([
        { documentId: doc.id, imageNo: 1 },
        { documentId: doc.id, imageNo: 2 },
      ])
    })

    it('rejects a page with neither folio nor image number', async () => {
      const doc = await makeDocument()
      await expectViolation(db.insert(pages).values({ documentId: doc.id }), '23514', 'pages_folio_or_image')
    })

    it('rejects a duplicate image number inside one document', async () => {
      const doc = await makeDocument()
      await db.insert(pages).values({ documentId: doc.id, imageNo: 4 })
      await expectViolation(
        db.insert(pages).values({ documentId: doc.id, imageNo: 4 }),
        '23505',
        'pages_document_image_unique',
      )
    })

    it('rejects a non-positive image number', async () => {
      const doc = await makeDocument()
      await expectViolation(
        db.insert(pages).values({ documentId: doc.id, imageNo: 0 }),
        '23514',
        'pages_image_no_positive',
      )
    })
  })

  describe('regions', () => {
    const base = { imageHash: hash }

    it('rejects a box outside the image', async () => {
      await expectViolation(
        db.insert(regions).values({ ...base, x: 0.8, y: 0, w: 0.5, h: 0.5 }),
        '23514',
        'regions_box',
      )
    })

    it('rejects a zero-size box', async () => {
      await expectViolation(
        db.insert(regions).values({ ...base, x: 0, y: 0, w: 0, h: 0.5 }),
        '23514',
        'regions_box',
      )
    })

    it('tolerates floating point error at the right edge', async () => {
      await db.insert(regions).values({ ...base, x: 0.5, y: 0, w: 0.5000001, h: 1 })
    })
  })

  describe('transcriptions', () => {
    it('refuses to delete a page that has transcriptions', async () => {
      const { page, region } = await makeRegion()
      await db.insert(transcriptions).values({ regionId: region.id, rawText: 'x', reader: 'test' })
      await expectViolation(db.delete(pages).where(sql`${pages.id} = ${page.id}`), '23001')
    })

    it('refuses to delete a transcription that has edit history', async () => {
      const { region } = await makeRegion()
      const [t] = await db
        .insert(transcriptions)
        .values({ regionId: region.id, rawText: 'x', reader: 'test' })
        .returning()
      if (!t) throw new Error('transcription not inserted')
      await db.insert(edits).values({ transcriptionId: t.id, lineIdx: 0, before: 'a', after: 'b' })
      await expectViolation(db.delete(transcriptions).where(sql`${transcriptions.id} = ${t.id}`), '23001')
    })

    it('rejects a verified transcription without a verification time', async () => {
      const { region } = await makeRegion()
      await expectViolation(
        db.insert(transcriptions).values({ regionId: region.id, rawText: 'x', reader: 'test', status: 'verified' }),
        '23514',
        'transcriptions_verified_has_time',
      )
    })

    it('rejects a duplicate version of one region', async () => {
      const { region } = await makeRegion()
      await db.insert(transcriptions).values({ regionId: region.id, rawText: 'x', reader: 'test' })
      await expectViolation(
        db.insert(transcriptions).values({ regionId: region.id, rawText: 'y', reader: 'test' }),
        '23505',
        'transcriptions_region_version_unique',
      )
    })
  })

  describe('recognitions', () => {
    it('allows only one active recognition per region', async () => {
      const { region } = await makeRegion()
      await db.insert(recognitions).values({ regionId: region.id, source: 'extension' })
      await expectViolation(
        db.insert(recognitions).values({ regionId: region.id, source: 'extension' }),
        '23505',
        'recognitions_one_active_per_region',
      )
    })

    it('allows a new recognition once the previous one has finished', async () => {
      const { region } = await makeRegion()
      await db.insert(recognitions).values({ regionId: region.id, source: 'extension', status: 'failed' })
      await db.insert(recognitions).values({ regionId: region.id, source: 'extension' })
    })
  })

  describe('corpus', () => {
    const makeSource = async (title: string) => {
      const [source] = await db
        .insert(sources)
        .values({ title, licence: 'test', kind: 'dictionary' })
        .returning()
      if (!source) throw new Error('source not inserted')
      return source
    }

    it('allows the same text in two sources but not twice in one', async () => {
      const first = await makeSource('Перше')
      const second = await makeSource('Друге')
      const row = (sourceId: string) => ({
        sourceId,
        text: 'восприємники',
        textHash: 'same-hash',
        type: 'term' as const,
        tsv: sql`to_tsvector('simple', 'восприємники')`,
      })
      await db.insert(chunks).values(row(first.id))
      await db.insert(chunks).values(row(second.id))
      await expectViolation(db.insert(chunks).values(row(first.id)), '23505', 'chunks_source_hash_unique')
    })

    it('requires a search vector', async () => {
      const source = await makeSource('Третє')
      await expectViolation(
        db.execute(
          sql`insert into chunks (id, source_id, text, text_hash, type) values (gen_random_uuid(), ${source.id}, 'a', 'h', 'term')`,
        ),
        '23502',
      )
    })

    it('finds a spelling variant by trigram similarity', async () => {
      const source = await makeSource('Четверте')
      await db.insert(chunks).values({
        sourceId: source.id,
        text: 'Борщагівка, село Київського повіту',
        textHash: 'borshchahivka',
        type: 'place',
        tsv: sql`to_tsvector('simple', 'Борщагівка, село Київського повіту')`,
      })
      const rows = await db
        .select({ id: chunks.id })
        .from(chunks)
        .where(sql`similarity(${chunks.text}, 'Борщагівка село') > 0.3`)
      expect(rows.length).toBeGreaterThan(0)
    })

    it('matches Cyrillic full text regardless of case', async () => {
      const result = await db.execute(
        sql`select to_tsvector('simple', 'Борщагівка') @@ plainto_tsquery('simple', 'борщагівка') as matched`,
      )
      expect(result.rows[0]).toEqual({ matched: true })
    })
  })
})

import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { regions, transcriptions } from '../src/db/schema.ts'
import {
  batchReader,
  importRecord,
  readingRecordSchema,
  versionOfReading,
  type ReadingRecord,
} from '../src/services/imports.ts'
import { findOrCreatePage } from '../src/services/recognitions.ts'
import { loadTranscription } from '../src/services/transcriptions.ts'
import { createTestDatabase, resetDatabase, type TestDatabase } from './helpers.ts'

const words = (text: string, uncertain: string[] = []) =>
  text.split(' ').map((word) => ({ text: word, uncertain: uncertain.includes(word) }))

const line = (text: string, uncertain: string[] = []) => ({ text, words: words(text, uncertain) })

const record = (changes: Partial<ReadingRecord> = {}): ReadingRecord =>
  readingRecordSchema.parse({
    box: { x: 0.1, y: 0.27, w: 0.83, h: 0.12 },
    lines: [line('Деревни Старыхъ Безрадичъ'), line('Прокопій Ко-', ['Ко-'])],
    normalized: [line('Деревни Старых Безрадич'), line('Прокопий Ко-', ['Ко-'])],
    translated: ['Села Старих Безрадичів', 'Прокопій Ко-'],
    entities: [
      { type: 'place', text: 'Старых Безрадич', normalized: 'Старые Безрадичи' },
      { type: 'person', text: 'Прокопий', normalized: 'Прокопий' },
    ],
    ...changes,
  })

describe('versionOfReading', () => {
  it('keeps the reading as a draft of the batch reader with estimated bands', () => {
    const version = versionOfReading(record())
    expect(version.reader).toBe(batchReader)
    expect(
      version.lines.map((read) => [read.idx, read.boxSource, read.box, read.uncertain]),
    ).toEqual([
      [0, 'estimated', { x: 0, y: 0, w: 1, h: 0.5 }, false],
      [1, 'estimated', { x: 0, y: 0.5, w: 1, h: 0.5 }, true],
    ])
    expect(version.normalized?.lines.map((read) => read.text)).toEqual([
      'Деревни Старых Безрадич',
      'Прокопий Ко-',
    ])
    expect(version.translatedLines).toEqual(['Села Старих Безрадичів', 'Прокопій Ко-'])
    expect(version.entities).toEqual([
      { type: 'place', text: 'Старых Безрадич', start: 8, end: 23, normalized: 'Старые Безрадичи' },
      { type: 'person', text: 'Прокопий', start: 24, end: 32, normalized: 'Прокопий' },
    ])
  })

  it('accepts a record without entities and keeps each of its warnings once', () => {
    const version = versionOfReading(
      record({ entities: [], warnings: ['cut_off_bottom', 'faint_ink', 'cut_off_bottom'] }),
    )
    expect(version.entities).toEqual([])
    expect(version.warnings).toEqual(['cut_off_bottom', 'faint_ink'])
  })

  it.each([
    [
      'the fita written as Ө of another alphabet',
      {
        lines: [line('Деревни Старыхъ Безрадичъ'), line('Өеодоръ Ко-', ['Ко-'])],
        normalized: [line('Деревни Старых Безрадич'), line('Федор Ко-', ['Ко-'])],
      },
      'Ө instead of Ѳ',
    ],
    [
      'words that do not add up to the line',
      { lines: [{ text: 'Деревни Старыхъ', words: words('Деревни') }, line('Прокопій Ко-')] },
      'do not add up',
    ],
    [
      'a line with a line break',
      { lines: [line('Деревни\nСтарыхъ'), line('Прокопій Ко-')] },
      'line 0',
    ],
    [
      'a normalization that changes more than the spelling',
      { normalized: [line('Деревни Новых Безрадич'), line('Прокопий Ко-', ['Ко-'])] },
      'changes more than the spelling',
    ],
    [
      'a normalization that drops the uncertain mark',
      { normalized: [line('Деревни Старых Безрадич'), line('Прокопий Ко-')] },
      'lost an uncertain word',
    ],
    [
      'a translation with another number of lines',
      { translated: ['Села Старих Безрадичів'] },
      'translation returned 1 of 2 lines',
    ],
    ['a translation in Latin letters', { translated: ['Sela Starykh', 'Прокопій Ко-'] }, 'Latin'],
    [
      'an entity that is not in the normalized text',
      { entities: [{ type: 'person' as const, text: 'Иван', normalized: 'Иван' }] },
      'entities do not match',
    ],
  ])('rejects %s', (_case, changes, message) => {
    expect(() => versionOfReading(record(changes))).toThrow(message)
  })
})

describe('importRecord', () => {
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

  const shelfmark = {
    archive: 'ЦДІАК України',
    fond: '127',
    opys: '1078',
    sprava: '1954',
    image: 10,
    portal: 'archium' as const,
    portalUrl: 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611',
  }

  const place = async (imageHash: string) => ({
    pageId: await findOrCreatePage(database.db, shelfmark, {
      document: { yearFrom: 1884, yearTo: 1884 },
    }),
    box: { x: 0.1, y: 0.27, w: 0.83, h: 0.12 },
    imageHash,
  })

  it('stores the record as a draft region of its page with the shelfmark of the sheet', async () => {
    expect(
      await importRecord(database.db, await place('a'.repeat(64)), versionOfReading(record())),
    ).toBe('created')
    const [stored] = await database.db.select().from(transcriptions)
    expect(stored?.status).toBe('draft')
    expect(stored?.reader).toBe(batchReader)
    const transcription = await loadTranscription(database.db, stored?.id ?? '', { warn: () => {} })
    expect(transcription?.shelfmark).toEqual(shelfmark)
    expect(transcription?.box).toEqual({ x: 0.1, y: 0.27, w: 0.83, h: 0.12 })
    expect(transcription?.normalizedText).toBe('Деревни Старых Безрадич\nПрокопий Ко-')
  })

  it('does not import the same region twice', async () => {
    const at = await place('b'.repeat(64))
    await importRecord(database.db, at, versionOfReading(record()))
    expect(await importRecord(database.db, at, versionOfReading(record()))).toBe('exists')
    expect(await database.db.select().from(transcriptions)).toHaveLength(1)
    expect(
      await database.db
        .select()
        .from(regions)
        .where(eq(regions.imageHash, 'b'.repeat(64))),
    ).toHaveLength(1)
  })
})

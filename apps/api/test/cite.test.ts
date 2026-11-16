import { citeResponseSchema } from '@khronist/contracts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { pages, transcriptions } from '../src/db/schema.ts'
import { maxCiteBodyBytes, recordReadsPerMinute } from '../src/lib/limits.ts'
import { insertTranscriptionVersion } from '../src/services/transcriptions.ts'
import {
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  type TestDatabase,
} from './helpers.ts'

const shelfmark = { archive: 'ЦДІАК України', fond: '127', opys: '1078', sprava: '1954', image: 4 }
const unknownId = '0190a000-0000-7000-8000-000000000000'
const reference = 'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 1954. Зобр. 4.'

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

const cite = (app: Created['app'], payload: unknown) =>
  app.inject({ method: 'POST', url: '/v1/cite', payload: payload as Record<string, unknown> })

const citedText = async (app: Created['app'], payload: Record<string, unknown>) => {
  const res = await cite(app, payload)
  expect(res.statusCode).toBe(200)
  return citeResponseSchema.strict().parse(res.json()).text
}

const verify = (id: string, signature: string) =>
  database.db
    .update(transcriptions)
    .set({
      status: 'verified',
      verifiedAt: new Date('2026-11-14T10:00:00.000Z'),
      verifiedSignature: signature,
    })
    .where(eq(transcriptions.id, id))

const newVersion = (regionId: string, text: string) =>
  insertTranscriptionVersion(database.db, {
    regionId,
    reader: 'fixture',
    lines: [
      {
        idx: 0,
        text,
        box: { x: 0, y: 0, w: 1, h: 0.1 },
        boxSource: 'estimated',
        uncertain: false,
        words: [{ text, uncertain: false }],
      },
    ],
    warnings: [],
    normalized: null,
    entities: [],
  })

describe('POST /v1/cite', () => {
  it.each<['dstu' | 'markdown' | 'text', string]>([
    ['dstu', reference],
    ['markdown', 'ЦДІАК України, ф. 127, оп. 1078, спр. 1954, зобр. 4'],
    ['text', 'ЦДІАК України, ф. 127, оп. 1078, спр. 1954, зобр. 4'],
  ])('cites the shelfmark in %s', async (format, expected) => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark })
    expect(
      await citedText(created.app, {
        transcriptionId: transcription.id,
        format,
        withTranscription: false,
      }),
    ).toBe(expected)
    await created.app.close()
  })

  it('adds the transcription of a draft with its uncertain words marked', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark })
    const text = await citedText(created.app, {
      transcriptionId: transcription.id,
      format: 'dstu',
      withTranscription: true,
    })
    expect(text).toBe(
      [
        reference,
        [
          'Села Борщаговки крестьянинъ Іоаннъ Петровъ Коваленко',
          'и законная жена его Марія Григоріева [?]',
          'оба православнаго исповѣданія',
        ].join('\n'),
        'Транскрипція: Хроніст (khronist.org). Чернетка, не підтверджена людиною. [?] — непевне прочитання.',
      ].join('\n\n'),
    )
    await created.app.close()
  })

  it('quotes the transcription in markdown', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark })
    const text = await citedText(created.app, {
      transcriptionId: transcription.id,
      format: 'markdown',
      withTranscription: true,
    })
    expect(text).toBe(
      [
        'ЦДІАК України, ф. 127, оп. 1078, спр. 1954, зобр. 4',
        [
          '> Села Борщаговки крестьянинъ Іоаннъ Петровъ Коваленко\\',
          '> и законная жена его Марія Григоріева \\[?\\]\\',
          '> оба православнаго исповѣданія',
        ].join('\n'),
        'Транскрипція: Хроніст (khronist.org). Чернетка, не підтверджена людиною. \\[?\\] — непевне прочитання.',
      ].join('\n\n'),
    )
    await created.app.close()
  })

  it('names a disputed version without the Commons licence', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark })
    await database.db
      .update(transcriptions)
      .set({ status: 'disputed' })
      .where(eq(transcriptions.id, transcription.id))
    const text = await citedText(created.app, {
      transcriptionId: transcription.id,
      format: 'text',
      withTranscription: true,
    })
    expect(
      text.endsWith(
        'Транскрипція: Хроніст (khronist.org). Спірна версія, не підтверджена. [?] — непевне прочитання.',
      ),
    ).toBe(true)
    await created.app.close()
  })

  it('cites the folio and the portal link of the page with the access date', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created, { shelfmark })
    const portalUrl = 'https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611'
    await database.db.update(pages).set({ folio: '14зв', sourceUrl: portalUrl })
    const text = await citedText(created.app, {
      transcriptionId: transcription.id,
      format: 'dstu',
      withTranscription: false,
    })
    expect(text).toMatch(
      new RegExp(
        `^ЦДІАК України\\. Ф\\. 127\\. Оп\\. 1078\\. Спр\\. 1954\\. Арк\\. 14зв\\. URL: ${portalUrl.replaceAll('.', '\\.')} \\(дата звернення: \\d{2}\\.\\d{2}\\.\\d{4}\\)\\.$`,
      ),
    )
    await created.app.close()
  })

  it('cites the latest verified version of the region, as search shows it', async () => {
    const created = await createTestApp(database)
    const first = await read(created, { shelfmark })
    await verify(first.id, 'О. Коваль, ЦДІАК')
    const latest = await newVersion(first.regionId, 'Села Борщаговки виправлено')

    const text = await citedText(created.app, {
      transcriptionId: latest,
      format: 'text',
      withTranscription: true,
    })
    expect(text).toContain('Марія Григоріева\n')
    expect(text).not.toContain('виправлено')
    expect(
      text.endsWith(
        'Транскрипція: Хроніст (khronist.org), CC BY 4.0. Підтверджено: «О. Коваль, ЦДІАК», 14.11.2026.',
      ),
    ).toBe(true)
    await created.app.close()
  })

  it('cites the later of two verified versions', async () => {
    const created = await createTestApp(database)
    const first = await read(created, { shelfmark })
    await verify(first.id, 'О. Коваль')
    const second = await newVersion(first.regionId, 'Села Борщаговки виправлено')
    await verify(second, 'М. Іваненко')
    await newVersion(first.regionId, 'новіша чернетка')

    const text = await citedText(created.app, {
      transcriptionId: first.id,
      format: 'text',
      withTranscription: true,
    })
    expect(text.split('\n\n').slice(1)).toEqual([
      'Села Борщаговки виправлено',
      'Транскрипція: Хроніст (khronist.org), CC BY 4.0. Підтверджено: «М. Іваненко», 14.11.2026.',
    ])
    await created.app.close()
  })

  it('cites the latest version of a region without a verified one', async () => {
    const created = await createTestApp(database)
    const first = await read(created, { shelfmark })
    await newVersion(first.regionId, 'Села Борщаговки виправлено')

    const text = await citedText(created.app, {
      transcriptionId: first.id,
      format: 'text',
      withTranscription: true,
    })
    expect(text.split('\n\n')[1]).toBe('Села Борщаговки виправлено')
    await created.app.close()
  })

  it('answers 404 for a fragment without a shelfmark', async () => {
    const created = await createTestApp(database)
    const transcription = await read(created)
    const res = await cite(created.app, {
      transcriptionId: transcription.id,
      format: 'text',
      withTranscription: false,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toEqual({
      code: 'not_found',
      message: 'У фрагмента немає шифру, тож цитату скласти не можна',
    })
    await created.app.close()
  })

  it('answers 404 for an unknown transcription', async () => {
    const { app } = await createTestApp(database)
    const res = await cite(app, {
      transcriptionId: unknownId,
      format: 'dstu',
      withTranscription: true,
    })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toEqual({ code: 'not_found', message: 'Транскрипцію не знайдено' })
    await app.close()
  })

  it.each<[string, unknown]>([
    ['a malformed id', { transcriptionId: 'abc', format: 'dstu', withTranscription: false }],
    ['an unknown format', { transcriptionId: unknownId, format: 'apa', withTranscription: false }],
    ['a missing flag', { transcriptionId: unknownId, format: 'dstu' }],
    [
      'a flag as a string',
      { transcriptionId: unknownId, format: 'dstu', withTranscription: 'true' },
    ],
  ])('answers 400 for %s', async (_case, payload) => {
    const { app } = await createTestApp(database)
    const res = await cite(app, payload)
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    await app.close()
  })

  it('answers 413 for a body over the limit', async () => {
    const { app } = await createTestApp(database)
    const res = await app.inject({
      method: 'POST',
      url: '/v1/cite',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({
        transcriptionId: unknownId,
        format: 'dstu',
        withTranscription: false,
        padding: 'ѣ'.repeat(maxCiteBodyBytes),
      }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('too_large')
    await app.close()
  })

  it(`allows ${recordReadsPerMinute} citations a minute from one address apart from reads`, async () => {
    const { app } = await createTestApp(database)
    const payload = { transcriptionId: unknownId, format: 'dstu', withTranscription: false }
    for (let i = 0; i < recordReadsPerMinute; i += 1) {
      expect((await cite(app, payload)).statusCode).toBe(404)
    }
    const limited = await cite(app, payload)
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    expect(limited.headers['retry-after']).toBeDefined()
    const read = await app.inject({ method: 'GET', url: `/v1/transcriptions/${unknownId}` })
    expect(read.statusCode).toBe(404)
    await app.close()
  })
})

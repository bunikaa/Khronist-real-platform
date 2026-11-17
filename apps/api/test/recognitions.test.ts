import { recognitionEventSchema, visionToLines } from '@khronist/contracts'
import { count, eq, inArray } from 'drizzle-orm'
import type { RecognitionEvent } from '@khronist/contracts'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { documents, pages, recognitions, regions, transcriptions } from '../src/db/schema.ts'
import { createEventHub } from '../src/jobs/events.ts'
import {
  failRecognitions,
  failStaleRecognitions,
  runRecognition,
  type JobDeps,
} from '../src/jobs/recognize.ts'
import { closeOwnRecognitions } from '../src/jobs/shutdown.ts'
import { maxBodyBytes } from '../src/lib/limits.ts'
import { createFixtureReader } from '../src/services/htr/fixture.ts'
import type { HtrReader } from '../src/services/htr/index.ts'
import { createLlmEntityExtractor, noEntities } from '../src/services/entities.ts'
import { parseOutput, type LlmProvider } from '../src/services/llm/index.ts'
import { passthroughNormalizer, type Normalizer } from '../src/services/normalize.ts'
import { noTranslation } from '../src/services/translate.ts'
import {
  createRecordingReader,
  createTestApp,
  createTestDatabase,
  emptyReader,
  failingReader,
  makePng,
  parseSse,
  recognitionBody,
  resetDatabase,
  silentLog,
  sleep,
  waitUntil,
  type TestDatabase,
} from './helpers.ts'

let size = 100
const nextPng = () => makePng((size += 1), 200)

const shelfmark = { archive: 'ЦДІАК', fond: '127', opys: '1078', sprava: '1954', portal: 'archium' }
const portalUrl = (image: number) =>
  `https://archium.cdiak.archives.gov.ua/file-viewer/133759#file-${image}`

describe('recognitions', () => {
  let database: TestDatabase

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.client.close()
  })

  type TestApp = Awaited<ReturnType<typeof createTestApp>>['app']

  const post = (app: TestApp, payload: unknown) =>
    app.inject({ method: 'POST', url: '/v1/recognitions', payload: payload as object })

  const get = (app: TestApp, id: string) =>
    app.inject({ method: 'GET', url: `/v1/recognitions/${id}` })

  const closeEveryActiveRecognition = () =>
    database.db
      .update(recognitions)
      .set({ status: 'failed', errorCode: 'restarted', finishedAt: new Date() })
      .where(inArray(recognitions.status, ['queued', 'reading', 'normalizing']))

  const activeCount = async () => {
    const [row] = await database.db
      .select({ n: count() })
      .from(recognitions)
      .where(inArray(recognitions.status, ['queued', 'reading', 'normalizing']))
    return row?.n ?? 0
  }

  const doneState = async (options: Parameters<typeof createTestApp>[1]) => {
    const { app, queue } = await createTestApp(database, options)
    const created = await post(app, recognitionBody(nextPng()))
    await queue.onIdle()
    const state = await get(app, created.json().recognitionId)
    await app.close()
    return state.json()
  }

  const regionCount = async () => {
    const [row] = await database.db.select({ n: count() }).from(regions)
    return row?.n ?? 0
  }

  describe('reading', () => {
    it('reads a fragment and exposes the finished transcription', async () => {
      const { app, queue } = await createTestApp(database)
      const created = await post(app, recognitionBody(nextPng()))
      expect(created.statusCode).toBe(201)
      expect(created.json().status).toBe('queued')

      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.statusCode).toBe(200)
      const body = state.json()
      expect(body.status).toBe('done')
      expect(body.transcription.reader).toBe('fixture')
      expect(body.transcription.status).toBe('draft')
      expect(body.transcription.box).toEqual({ x: 0, y: 0, w: 1, h: 1 })
      expect(body.transcription.lines).toHaveLength(3)
      expect(
        body.transcription.lines.every((l: { boxSource: string }) => l.boxSource === 'estimated'),
      ).toBe(true)
      expect(body.transcription.lines[1].uncertain).toBe(true)
      expect(body.transcription.lines[1].words[5]).toEqual({ text: 'Григоріева', uncertain: true })
      expect(body.transcription.normalizedText.split('\n')).toHaveLength(3)

      const [row] = await database.db
        .select({ source: recognitions.source, attempts: recognitions.attempts })
        .from(recognitions)
        .where(eq(recognitions.id, created.json().recognitionId))
      expect(row).toEqual({ source: 'extension', attempts: 1 })
      await app.close()
    })

    it('stores the selected box and passes the hints to the reader', async () => {
      const recorder = createRecordingReader()
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const box = { x: 0.1, y: 0.2, w: 0.5, h: 0.4 }
      const hints = { language: 'ru', period: '19', documentType: 'metric' }
      const created = await post(app, recognitionBody(nextPng(), { box, hints }))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().transcription.box).toEqual(box)
      expect(recorder.inputs).toHaveLength(1)
      expect(recorder.inputs[0]?.hints).toEqual(hints)
      await app.close()
    })

    it('answers a repeated fragment from the cache without reading it again', async () => {
      const recorder = createRecordingReader()
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const png = nextPng()
      const first = await post(app, recognitionBody(png))
      await queue.onIdle()
      const state = await get(app, first.json().recognitionId)

      const second = await post(app, recognitionBody(png, { source: 'web' }))
      expect(second.statusCode).toBe(201)
      expect(second.json().status).toBe('cached')
      expect(second.json().transcriptionId).toBe(state.json().transcription.id)
      expect(second.json().recognitionId).not.toBe(first.json().recognitionId)
      expect(recorder.inputs).toHaveLength(1)

      const cachedState = await get(app, second.json().recognitionId)
      expect(cachedState.json().status).toBe('done')
      expect(cachedState.json().transcription.id).toBe(state.json().transcription.id)
      await app.close()
    })

    it('serves cached fragments even when the reader is unavailable', async () => {
      const working = await createTestApp(database)
      const png = nextPng()
      await post(working.app, recognitionBody(png))
      await working.queue.onIdle()
      await working.app.close()

      const down = await createTestApp(database, { reader: undefined })
      const res = await post(down.app, recognitionBody(png))
      expect(res.statusCode).toBe(201)
      expect(res.json().status).toBe('cached')
      await down.app.close()
    })

    it('does not start two readings for the same fragment, one after the other', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const png = nextPng()
      const first = await post(app, recognitionBody(png))
      const second = await post(app, recognitionBody(png))
      expect(second.json().recognitionId).toBe(first.json().recognitionId)
      recorder.release()
      await queue.onIdle()
      expect(recorder.inputs).toHaveLength(1)
      await app.close()
    })

    it('does not start two readings when identical requests arrive together', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const body = recognitionBody(nextPng(), {
        shelfmark: { ...shelfmark, sprava: '5001', image: 4 },
      })
      const responses = await Promise.all(Array.from({ length: 5 }, () => post(app, body)))
      expect(responses.map((r) => r.statusCode)).toEqual([201, 201, 201, 201, 201])
      expect(new Set(responses.map((r) => r.json().recognitionId)).size).toBe(1)
      recorder.release()
      await queue.onIdle()
      expect(recorder.inputs).toHaveLength(1)
      await app.close()
    })

    it('handles two new fragments of one new document arriving together', async () => {
      const { app, queue } = await createTestApp(database)
      const make = (image: number) =>
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava: '5002', image } })
      const [a, b] = await Promise.all([post(app, make(1)), post(app, make(2))])
      expect([a.statusCode, b.statusCode]).toEqual([201, 201])
      await queue.onIdle()
      const rows = await database.db.select().from(documents).where(eq(documents.sprava, '5002'))
      expect(rows).toHaveLength(1)
      await app.close()
    })

    it('stores the shelfmark without the guest portal link and reuses the document', async () => {
      const { app, queue } = await createTestApp(database)
      const withImage = (image: number) => ({ ...shelfmark, image, portalUrl: portalUrl(image) })
      const first = await post(app, recognitionBody(nextPng(), { shelfmark: withImage(4) }))
      const second = await post(app, recognitionBody(nextPng(), { shelfmark: withImage(5) }))
      await queue.onIdle()

      const state = await get(app, first.json().recognitionId)
      expect(state.json().transcription.shelfmark).toEqual({
        archive: shelfmark.archive,
        fond: shelfmark.fond,
        opys: shelfmark.opys,
        sprava: shelfmark.sprava,
        image: 4,
      })
      const other = await get(app, second.json().recognitionId)
      expect(other.json().transcription.shelfmark.image).toBe(5)

      const rows = await database.db.select().from(documents).where(eq(documents.sprava, '1954'))
      expect(rows).toHaveLength(1)
      await app.close()
    })

    it('accepts a shelfmark with only a folio', async () => {
      const { app, queue } = await createTestApp(database)
      const created = await post(
        app,
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava: '5003', folio: '14зв' } }),
      )
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().transcription.shelfmark.folio).toBe('14зв')
      expect(state.json().transcription.shelfmark.image).toBeUndefined()
      await app.close()
    })

    it('identifies an image page by its number and keeps no folio sent by a guest', async () => {
      const { app, queue } = await createTestApp(database)
      const sprava = '5004'
      const first = await post(
        app,
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava, folio: 'F', image: 7 } }),
      )
      const second = await post(
        app,
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava, folio: 'F', image: 5 } }),
      )
      expect([first.statusCode, second.statusCode]).toEqual([201, 201])
      await queue.onIdle()
      const [document] = await database.db
        .select()
        .from(documents)
        .where(eq(documents.sprava, sprava))
      const rows = await database.db
        .select()
        .from(pages)
        .where(eq(pages.documentId, document?.id ?? ''))
      expect(rows.map((r) => [r.imageNo, r.folio]).sort()).toEqual([
        [5, null],
        [7, null],
      ])
      await app.close()
    })

    it('keeps the first shelfmark of a fragment and does not overwrite it later', async () => {
      const { app, queue } = await createTestApp(database)
      const png = nextPng()
      const first = await post(
        app,
        recognitionBody(png, { shelfmark: { ...shelfmark, sprava: '5005', image: 1 } }),
      )
      await queue.onIdle()
      await post(
        app,
        recognitionBody(png, { shelfmark: { ...shelfmark, sprava: '5006', image: 9 } }),
      )
      const state = await get(app, first.json().recognitionId)
      expect(state.json().transcription.shelfmark.sprava).toBe('5005')
      await app.close()
    })

    it('refuses new work when the queue is full and accepts it again after it drains', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, {
        reader: recorder.reader,
        maxBacklog: 2,
      })
      const rejectedPng = nextPng()
      const first = await post(app, recognitionBody(nextPng()))
      const second = await post(app, recognitionBody(nextPng()))
      const third = await post(app, recognitionBody(rejectedPng))
      expect([first.statusCode, second.statusCode, third.statusCode]).toEqual([201, 201, 429])
      expect(third.json().error.code).toBe('too_many_requests')
      expect(third.headers['retry-after']).toBe('60')
      recorder.release()
      await queue.onIdle()
      const again = await post(app, recognitionBody(rejectedPng))
      expect(again.statusCode).toBe(201)
      expect(again.json().status).toBe('queued')
      await queue.onIdle()
      await app.close()
    })

    it('writes no document or page for a request refused with 429', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, {
        reader: recorder.reader,
        maxBacklog: 1,
      })
      await post(app, recognitionBody(nextPng()))
      const refused = await post(
        app,
        recognitionBody(nextPng(), {
          shelfmark: { ...shelfmark, sprava: '6001', image: 4, folio: '999' },
        }),
      )
      expect(refused.statusCode).toBe(429)
      expect(
        await database.db.select().from(documents).where(eq(documents.sprava, '6001')),
      ).toEqual([])
      recorder.release()
      await queue.onIdle()
      await app.close()
    })

    it('answers 503 before calling the model when the daily model budget is spent', async () => {
      const recorder = createRecordingReader()
      const { app } = await createTestApp(database, {
        reader: recorder.reader,
        budget: { spend: async () => false, available: async () => false },
      })
      const res = await post(app, recognitionBody(nextPng()))
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe('reader_unavailable')
      expect(recorder.inputs).toHaveLength(0)
      await app.close()
    })

    it('limits parallel requests with the reservation, not with a later check', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, {
        reader: recorder.reader,
        maxBacklog: 2,
      })
      const responses = await Promise.all(
        Array.from({ length: 8 }, () => post(app, recognitionBody(nextPng()))),
      )
      const accepted = responses.filter((r) => r.statusCode === 201).length
      const refused = responses.filter((r) => r.statusCode === 429).length
      expect([accepted, refused]).toEqual([2, 6])
      recorder.release()
      await queue.onIdle()
      await app.close()
    })
  })

  describe('job state', () => {
    const regionOf = async () => {
      const [region] = await database.db
        .insert(regions)
        .values({ x: 0, y: 0, w: 1, h: 1, imageHash: sha(nextPng()) })
        .returning()
      if (!region) throw new Error('region not inserted')
      return region
    }
    const sha = (bytes: Buffer) => bytes.toString('hex').padEnd(64, '0').slice(0, 64)

    const queuedRecognition = async (regionId: string) => {
      const [row] = await database.db
        .insert(recognitions)
        .values({ regionId, source: 'batch' })
        .returning()
      if (!row) throw new Error('recognition not inserted')
      return row
    }

    const jobDeps = (): JobDeps => ({
      db: database.db,
      reader: createFixtureReader(),
      normalizer: passthroughNormalizer,
      entities: noEntities,
      translator: noTranslation,
      hub: createEventHub(),
      log: silentLog,
    })

    it('adds a new version instead of failing when the region is already transcribed', async () => {
      const region = await regionOf()
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const row = await queuedRecognition(region.id)
        await runRecognition(jobDeps(), { recognitionId: row.id, image: Buffer.from('x') })
        const [after] = await database.db
          .select()
          .from(recognitions)
          .where(eq(recognitions.id, row.id))
        expect(after?.status).toBe('done')
      }
      const versions = await database.db
        .select({ version: transcriptions.version })
        .from(transcriptions)
        .where(eq(transcriptions.regionId, region.id))
      expect(versions.map((v) => v.version).sort()).toEqual([1, 2])
    })

    it('saves a normalization that answers in 15 s, inside the budget of its stage', async () => {
      const region = await regionOf()
      const row = await queuedRecognition(region.id)
      const normalizer: Normalizer = {
        normalize: ({ lines }) =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  lines: lines.map((line) => ({ text: line.text, words: line.words })),
                  expansions: [],
                }),
              15_000,
            ),
          ),
      }
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      try {
        let settled = false
        const job = runRecognition(
          { ...jobDeps(), normalizer },
          { recognitionId: row.id, image: Buffer.from('x') },
        ).finally(() => {
          settled = true
        })
        for (let step = 0; step < 100 && !settled; step += 1) {
          await new Promise((resolve) => setImmediate(resolve))
          await vi.advanceTimersByTimeAsync(500)
        }
        await job
      } finally {
        vi.useRealTimers()
      }
      const [after] = await database.db
        .select({ status: recognitions.status, transcriptionId: recognitions.transcriptionId })
        .from(recognitions)
        .where(eq(recognitions.id, row.id))
      expect(after?.status).toBe('done')
      const [saved] = await database.db
        .select({ normalizedLines: transcriptions.normalizedLines })
        .from(transcriptions)
        .where(eq(transcriptions.id, after?.transcriptionId ?? ''))
      expect(saved?.normalizedLines).toHaveLength(3)
    })

    it('does not resurrect a recognition that was closed while its job was running', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const created = await post(app, recognitionBody(nextPng()))
      await waitUntil(() => recorder.inputs.length === 1)

      await failRecognitions(database.db, [created.json().recognitionId], 'restarted')
      recorder.release()
      await queue.onIdle()

      const state = await get(app, created.json().recognitionId)
      expect(state.json().status).toBe('failed')
      expect(state.json().error.code).toBe('restarted')
      expect(state.json().transcription).toBeUndefined()
      await app.close()
    })

    it('stops waiting for a stuck recognition and starts a new reading', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const png = nextPng()
      const stuck = await post(app, recognitionBody(png))
      await waitUntil(() => recorder.inputs.length === 1)
      await database.db
        .update(recognitions)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(recognitions.id, stuck.json().recognitionId))

      const fresh = await post(app, recognitionBody(png))
      expect(fresh.json().recognitionId).not.toBe(stuck.json().recognitionId)
      expect(fresh.json().status).toBe('queued')
      const [old] = await database.db
        .select({ status: recognitions.status })
        .from(recognitions)
        .where(eq(recognitions.id, stuck.json().recognitionId))
      expect(old?.status).toBe('failed')

      recorder.release()
      await queue.onIdle()
      const state = await get(app, fresh.json().recognitionId)
      expect(state.json().status).toBe('done')
      await app.close()
    })
  })

  describe('what the job records', () => {
    const closingNormalizer = (outcome: 'answers' | 'throws'): Normalizer => ({
      normalize: async () => {
        await closeEveryActiveRecognition()
        if (outcome === 'throws') throw new Error('boom')
        return null
      },
    })

    it('saves nothing and finds no entities when the recognition is closed during normalization', async () => {
      const extract = vi.fn(async () => [])
      const { app, queue } = await createTestApp(database, {
        normalizer: closingNormalizer('answers'),
        entities: { extract },
      })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().status).toBe('failed')
      expect(state.json().error.code).toBe('restarted')
      expect(state.json().transcription).toBeUndefined()
      expect(extract).not.toHaveBeenCalled()
      await app.close()
    })

    it('keeps the first failure code and tells the stream the same one', async () => {
      const { app, hub, queue } = await createTestApp(database, {
        normalizer: closingNormalizer('throws'),
      })
      const created = await post(app, recognitionBody(nextPng()))
      const events: RecognitionEvent[] = []
      hub.subscribe(created.json().recognitionId, (event) => events.push(event))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().error.code).toBe('restarted')
      expect(events.at(-1)).toMatchObject({ event: 'failed', data: { code: 'restarted' } })
      await app.close()
    })

    it('tells the stream of a stale recognition the code that was stored', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, hub, queue } = await createTestApp(database, { reader: recorder.reader })
      const png = nextPng()
      const stuck = await post(app, recognitionBody(png))
      await waitUntil(() => recorder.inputs.length === 1)
      const events: RecognitionEvent[] = []
      hub.subscribe(stuck.json().recognitionId, (event) => events.push(event))
      await database.db
        .update(recognitions)
        .set({ createdAt: new Date(Date.now() - 60 * 60_000) })
        .where(eq(recognitions.id, stuck.json().recognitionId))
      await post(app, recognitionBody(png))
      recorder.release()
      await queue.onIdle()
      expect(events.at(-1)).toMatchObject({ event: 'failed', data: { code: 'read_failed' } })
      await app.close()
    })

    it('stores the warnings of the reader and returns them', async () => {
      const inner = createFixtureReader()
      const reader: HtrReader = {
        ...inner,
        read: async (input) => ({ ...(await inner.read(input)), warnings: ['cut_off_right'] }),
      }
      const state = await doneState({ reader })
      expect(state.transcription.warnings).toEqual(['cut_off_right'])
      const plain = await doneState({})
      expect(plain.transcription.warnings).toBeUndefined()
    })

    it('stores normalized lines and expansions and builds the text from them', async () => {
      const normalizer: Normalizer = {
        normalize: async ({ lines }) => ({
          lines: lines.map((line) => ({
            text: line.words.map((word) => word.text.replace(/ъ$/, '')).join(' '),
            words: line.words.map((word) => ({ ...word, text: word.text.replace(/ъ$/, '') })),
          })),
          expansions: [{ from: 'крестьянинъ', to: 'крестьянин' }],
        }),
      }
      const state = await doneState({ normalizer })
      const { transcription } = state
      expect(transcription.normalizedLines).toHaveLength(3)
      expect(transcription.normalizedText.split('\n')[0]).toBe(
        'Села Борщаговки крестьянин Іоанн Петров Коваленко',
      )
      expect(transcription.normalizedLines[1].words[5]).toEqual({
        text: 'Григоріева',
        uncertain: true,
      })
      expect(transcription.expansions).toEqual([{ from: 'крестьянинъ', to: 'крестьянин' }])
    })

    it('keeps the lines as read when normalization breaks a rule of the contract', async () => {
      const broken: Normalizer[] = [
        { normalize: async () => ({ lines: [], expansions: [] }) },
        {
          normalize: async ({ lines }) => ({
            lines: lines.map((line) => ({
              text: line.text,
              words: line.words.map((word) => ({ ...word, uncertain: false })),
            })),
            expansions: [],
          }),
        },
        {
          normalize: async ({ lines }) => ({
            lines: lines.map((line) => ({
              text: `${line.text} зайве`,
              words: [...line.words, { text: 'зайве', uncertain: false }],
            })),
            expansions: [],
          }),
        },
      ]
      for (const normalizer of broken) {
        const state = await doneState({ normalizer })
        expect(state.status).toBe('done')
        expect(state.transcription.normalizedLines).toBeUndefined()
      }
    })

    it('records the model that actually read the fragment', async () => {
      const inner = createFixtureReader()
      const { app, queue } = await createTestApp(database, {
        reader: {
          ...inner,
          read: async (input) => ({ ...(await inner.read(input)), reader: 'gemini-x' }),
        },
      })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().transcription.reader).toBe('gemini-x')
      await app.close()
    })

    it('stores entities and returns them', async () => {
      const entity = {
        type: 'place',
        text: 'Борщаговки',
        start: 5,
        end: 15,
        normalized: 'Борщагівка',
        wikidataId: 'Q1',
        extra: { modern: 'Київ' },
      } as const
      const { app, queue } = await createTestApp(database, {
        entities: { extract: async () => [entity] },
      })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().transcription.entities).toEqual([entity])
      await app.close()
    })

    it('stores a date entity with its new style and returns it from both routes', async () => {
      const record = 'крещенъ 12 генваря 1884 года'
      const reader: HtrReader = {
        kind: 'fixture',
        read: async () => ({
          lines: visionToLines({
            lines: [
              {
                text: record,
                words: record.split(' ').map((text) => ({ text, uncertain: false })),
              },
            ],
            warnings: [],
          }),
          warnings: [],
          reader: 'fixture',
        }),
      }
      const model: LlmProvider = {
        name: 'claude-test',
        complete: async (request) => ({
          value: parseOutput(
            JSON.stringify({
              entities: [
                { type: 'date', text: '12 генваря 1884 года', normalized: '12 генваря 1884 года' },
              ],
            }),
            request.schema,
          ),
          model: 'claude-test',
          usage: { inputTokens: 1, outputTokens: 1 },
        }),
      }
      const { app, queue } = await createTestApp(database, {
        reader,
        entities: createLlmEntityExtractor(model),
      })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      const stored = {
        type: 'date',
        text: '12 генваря 1884 года',
        start: 8,
        end: 28,
        normalized: '12 генваря 1884 года',
        extra: { newStyle: '1884-01-24', weekday: 'четвер' },
      }
      expect(state.json().transcription.entities).toEqual([stored])
      const read = await app.inject({
        method: 'GET',
        url: `/v1/transcriptions/${state.json().transcription.id}`,
      })
      expect(read.json().entities).toEqual([stored])
      await app.close()
    })

    it('saves the transcription without entities that do not match the text', async () => {
      const misplaced = { type: 'place', text: 'Борщаговка', start: 0, end: 10 } as const
      const { app, queue } = await createTestApp(database, {
        entities: { extract: async () => [misplaced] },
      })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      expect(state.json().status).toBe('done')
      expect(state.json().transcription.entities).toEqual([])
      await app.close()
    })

    it('answers from the cache with the newest version of a region', async () => {
      const png = nextPng()
      const { app, hub, queue } = await createTestApp(database)
      const first = await post(app, recognitionBody(png))
      await queue.onIdle()
      const [row] = await database.db
        .select({ regionId: recognitions.regionId })
        .from(recognitions)
        .where(eq(recognitions.id, first.json().recognitionId))
      const [again] = await database.db
        .insert(recognitions)
        .values({ regionId: row?.regionId ?? '', source: 'batch' })
        .returning()
      await runRecognition(
        {
          db: database.db,
          reader: createFixtureReader(),
          normalizer: passthroughNormalizer,
          entities: noEntities,
          translator: noTranslation,
          hub,
          log: silentLog,
        },
        { recognitionId: again?.id ?? '', image: png },
      )
      const cached = await post(app, recognitionBody(png))
      const state = await get(app, cached.json().recognitionId)
      expect(state.json().transcription.version).toBe(2)
      await app.close()
    })
  })

  describe('validation', () => {
    it('rejects a hash that does not match the image and creates nothing', async () => {
      const { app } = await createTestApp(database)
      const before = await regionCount()
      const res = await post(app, { ...recognitionBody(nextPng()), imageHash: 'b'.repeat(64) })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('bad_image')
      expect(await regionCount()).toBe(before)
      await app.close()
    })

    it('rejects data that is not a PNG', async () => {
      const { app } = await createTestApp(database)
      const res = await post(
        app,
        recognitionBody(Buffer.from('not an image at all, just text, long enough to pass')),
      )
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('bad_image')
      await app.close()
    })

    it('answers 503 when no reader is configured and the fragment is new', async () => {
      const { app } = await createTestApp(database, { reader: undefined })
      const res = await post(app, recognitionBody(nextPng()))
      expect(res.statusCode).toBe(503)
      expect(res.json().error.code).toBe('reader_unavailable')
      await app.close()
    })

    it('rejects boxes the database would refuse with a 400, not a 500', async () => {
      const { app } = await createTestApp(database)
      for (const box of [
        { x: 0.9, y: 0, w: 0.5, h: 0.5 },
        { x: 0, y: 0, w: 0, h: 0.5 },
        { x: 0, y: 0.6, w: 0.5, h: 0.5 },
      ]) {
        const res = await post(app, recognitionBody(nextPng(), { box }))
        expect(res.statusCode, JSON.stringify(box)).toBe(400)
        expect(res.json().error.code).toBe('bad_request')
      }
      await app.close()
    })

    it('rejects hostile shelfmarks with a 400', async () => {
      const { app } = await createTestApp(database)
      const bad = [
        { ...shelfmark, image: 2 ** 31 },
        { ...shelfmark, image: 0 },
        { ...shelfmark, image: 1, archive: 'я'.repeat(3000) },
        { ...shelfmark, image: 1, fond: `12${String.fromCharCode(0)}7` },
        { ...shelfmark, image: 1, sprava: '   ' },
        {
          ...shelfmark,
          image: 1,
          portalUrl: 'https://user:secret@archium.cdiak.archives.gov.ua/x',
        },
        { ...shelfmark, image: 1, portalUrl: 'javascript:alert(1)' },
        { ...shelfmark, portal: 'searcharchives', image: 1 },
        shelfmark,
      ]
      for (const candidate of bad) {
        const res = await post(app, recognitionBody(nextPng(), { shelfmark: candidate }))
        expect(res.statusCode, JSON.stringify(candidate).slice(0, 80)).toBe(400)
      }
      await app.close()
    })

    it('answers 400 rather than failing for a portal link that is not an address', async () => {
      const { app } = await createTestApp(database)
      for (const portalUrl of ['', 'archium.cdiak.archives.gov.ua/file-viewer/134082']) {
        const res = await post(
          app,
          recognitionBody(nextPng(), { shelfmark: { ...shelfmark, image: 1, portalUrl } }),
        )
        expect(res.statusCode, portalUrl).toBe(400)
        expect(res.json().error.code).toBe('bad_request')
      }
      await app.close()
    })

    it('trims whitespace in shelfmark parts so that spellings do not split documents', async () => {
      const { app, queue } = await createTestApp(database)
      await post(
        app,
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava: ' 5007 ', image: 1 } }),
      )
      await post(
        app,
        recognitionBody(nextPng(), { shelfmark: { ...shelfmark, sprava: '5007', image: 2 } }),
      )
      await queue.onIdle()
      const rows = await database.db.select().from(documents).where(eq(documents.sprava, '5007'))
      expect(rows).toHaveLength(1)
      await app.close()
    })

    it('rejects an oversized request body with the too_large code', async () => {
      const { app } = await createTestApp(database)
      const res = await app.inject({
        method: 'POST',
        url: '/v1/recognitions',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ filler: 'a'.repeat(maxBodyBytes + 1) }),
      })
      expect(res.statusCode).toBe(413)
      expect(res.json().error.code).toBe('too_large')
      await app.close()
    })

    it('answers 404 for an unknown recognition and 400 for a malformed id', async () => {
      const { app } = await createTestApp(database)
      const unknown = '019254c0-0000-7000-8000-000000000000'
      expect((await get(app, unknown)).statusCode).toBe(404)
      expect((await get(app, 'not-a-uuid')).statusCode).toBe(400)
      const events = await app.inject({ method: 'GET', url: `/v1/recognitions/${unknown}/events` })
      expect(events.statusCode).toBe(404)
      await app.close()
    })
  })

  describe('failures', () => {
    const failedState = async (options: Parameters<typeof createTestApp>[1]) => {
      const { app, queue } = await createTestApp(database, options)
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const state = await get(app, created.json().recognitionId)
      await app.close()
      return state.json()
    }

    it('records a reader error as read_failed without leaking its message', async () => {
      const state = await failedState({ reader: failingReader('secret model endpoint is down') })
      expect(state.status).toBe('failed')
      expect(state.error).toEqual({ code: 'read_failed', message: 'Не вдалося прочитати фрагмент' })
      expect(state.transcription).toBeUndefined()
    })

    it('treats an empty reading as no_text', async () => {
      const state = await failedState({ reader: emptyReader })
      expect(state.error).toEqual({
        code: 'no_text',
        message: 'На фрагменті не знайдено тексту. Виділіть ділянку із записом',
      })
      expect(state.transcription).toBeUndefined()
    })

    it('rejects a reading with an impossible box as read_failed', async () => {
      const inner = createFixtureReader()
      const state = await failedState({
        reader: {
          ...inner,
          read: async (input) => {
            const read = await inner.read(input)
            return {
              ...read,
              lines: read.lines.map((line) => ({ ...line, box: { x: 0.9, y: 0, w: 0.5, h: 0.1 } })),
            }
          },
        },
      })
      expect(state.error.code).toBe('read_failed')
    })

    it('keeps the lines as read when normalization fails', async () => {
      const state = await doneState({
        normalizer: {
          normalize: async () => {
            throw new Error('boom')
          },
        },
      })
      expect(state.status).toBe('done')
      expect(state.transcription.normalizedText).toBe(
        state.transcription.lines.map((line: { text: string }) => line.text).join('\n'),
      )
      expect(state.transcription.normalizedLines).toBeUndefined()
    })

    it('saves the transcription without entities when entity extraction fails', async () => {
      for (const extract of [
        async () => {
          throw new Error('boom')
        },
        async () => [{ type: 'place' as const, text: 'abc', start: 2, end: 2 }],
      ]) {
        const state = await doneState({ entities: { extract } })
        expect(state.status).toBe('done')
        expect(state.transcription.entities).toEqual([])
      }
    })

    it('fails a reading that exceeds the timeout and cancels the reader', async () => {
      const recorder = createRecordingReader({ gated: true })
      const state = await failedState({ reader: recorder.reader, readTimeoutMs: 30 })
      expect(state.error.code).toBe('read_failed')
      expect(recorder.inputs[0]?.signal?.aborted).toBe(true)
      recorder.release()
    })

    it('keeps the lines as read when normalization or entities exceed their timeouts', async () => {
      const state = await doneState({
        normalizeTimeoutMs: 30,
        entitiesTimeoutMs: 30,
        normalizer: { normalize: () => new Promise(() => {}) },
        entities: { extract: () => new Promise(() => {}) },
      })
      expect(state.status).toBe('done')
      expect(state.transcription.normalizedLines).toBeUndefined()
      expect(state.transcription.entities).toEqual([])
    })

    it('allows a new attempt for a fragment whose reading failed', async () => {
      const png = nextPng()
      const broken = await createTestApp(database, { reader: failingReader('down') })
      const first = await post(broken.app, recognitionBody(png))
      await broken.queue.onIdle()
      await broken.app.close()

      const working = await createTestApp(database)
      const retry = await post(working.app, recognitionBody(png))
      expect(retry.json().status).toBe('queued')
      expect(retry.json().recognitionId).not.toBe(first.json().recognitionId)
      await working.queue.onIdle()
      const state = await get(working.app, retry.json().recognitionId)
      expect(state.json().status).toBe('done')
      await working.app.close()
    })
  })

  describe('event stream', () => {
    const stream = (app: TestApp, id: string) =>
      app.inject({ method: 'GET', url: `/v1/recognitions/${id}/events` })

    it('tells a client that connects to a waiting recognition where it stands', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, {
        reader: recorder.reader,
        maxStreamMs: 60,
      })
      await post(app, recognitionBody(nextPng()))
      await post(app, recognitionBody(nextPng()))
      const waiting = await post(app, recognitionBody(nextPng()))
      const res = await stream(app, waiting.json().recognitionId)
      expect(parseSse(res.body)).toEqual([{ event: 'progress', data: { status: 'queued' } }])
      recorder.release()
      await queue.onIdle()
      await app.close()
    })

    it('lets go of the recognition when the client disconnects', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, hub, queue } = await createTestApp(database, { reader: recorder.reader })
      const created = await post(app, recognitionBody(nextPng()))
      await waitUntil(() => recorder.inputs.length === 1)
      let released = false
      const subscribe = hub.subscribe
      hub.subscribe = (id, listener) => {
        const stop = subscribe(id, listener)
        return () => {
          released = true
          stop()
        }
      }
      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const controller = new AbortController()
      const res = await fetch(`${address}/v1/recognitions/${created.json().recognitionId}/events`, {
        signal: controller.signal,
      })
      await res.body?.getReader().read()
      controller.abort()
      await waitUntil(() => released)
      recorder.release()
      await queue.onIdle()
      await app.close()
    })

    it('replays the whole reading to a client that connects afterwards', async () => {
      const { app, queue } = await createTestApp(database)
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const res = await stream(app, created.json().recognitionId)
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/event-stream')
      const events = parseSse(res.body)
      expect(events.map((e) => e.event)).toEqual([
        'progress',
        'line',
        'line',
        'line',
        'progress',
        'done',
      ])
      for (const event of events) expect(recognitionEventSchema.safeParse(event).success).toBe(true)

      const state = await get(app, created.json().recognitionId)
      expect(events.at(-1)?.data).toEqual({ transcriptionId: state.json().transcription.id })
      await app.close()
    })

    it('delivers events live to a client that connected before the reading finished', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const created = await post(app, recognitionBody(nextPng()))
      await waitUntil(() => recorder.inputs.length === 1)
      const pending = stream(app, created.json().recognitionId)
      await sleep(120)
      recorder.release()
      const res = await pending
      await queue.onIdle()
      expect(parseSse(res.body).map((e) => e.event)).toEqual([
        'progress',
        'line',
        'line',
        'line',
        'progress',
        'done',
      ])
      expect(res.body).toContain(': ping')
      await app.close()
    })

    it('reports a failure through the stream', async () => {
      const { app, queue } = await createTestApp(database, { reader: failingReader('down') })
      const created = await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      const res = await stream(app, created.json().recognitionId)
      expect(parseSse(res.body).at(-1)).toEqual({
        event: 'failed',
        data: { code: 'read_failed', message: 'Не вдалося прочитати фрагмент' },
      })
      await app.close()
    })

    it('reports an empty reading as no_text to a live stream', async () => {
      const { app, hub, queue } = await createTestApp(database, { reader: emptyReader })
      const events: RecognitionEvent[] = []
      const created = await post(app, recognitionBody(nextPng()))
      hub.subscribe(created.json().recognitionId, (event) => events.push(event))
      await queue.onIdle()
      expect(events.at(-1)).toEqual({
        event: 'failed',
        data: {
          code: 'no_text',
          message: 'На фрагменті не знайдено тексту. Виділіть ділянку із записом',
        },
      })
      await app.close()
    })

    it('tells a waiting stream the result that another instance wrote to the database', async () => {
      const [region] = await database.db
        .insert(regions)
        .values({ x: 0, y: 0, w: 1, h: 1, imageHash: 'f'.repeat(64) })
        .returning()
      const [row] = await database.db
        .insert(recognitions)
        .values({ regionId: region?.id ?? '', source: 'batch', status: 'reading' })
        .returning()
      const { app } = await createTestApp(database, { maxStreamMs: 2000 })
      const pending = stream(app, row?.id ?? '')
      await sleep(50)
      await failRecognitions(database.db, [row?.id ?? ''], 'restarted')
      const res = await pending
      expect(parseSse(res.body).map((e) => e.event)).toEqual(['progress', 'failed'])
      await app.close()
    })

    it('builds the stream from the database when there is no live history', async () => {
      const { app, queue } = await createTestApp(database)
      const png = nextPng()
      await post(app, recognitionBody(png))
      await queue.onIdle()
      const cached = await post(app, recognitionBody(png))
      const res = await stream(app, cached.json().recognitionId)
      expect(parseSse(res.body).map((e) => e.event)).toEqual(['line', 'line', 'line', 'done'])
      await app.close()
    })

    it('reports a restarted recognition from the database', async () => {
      const [region] = await database.db
        .insert(regions)
        .values({ x: 0, y: 0, w: 1, h: 1, imageHash: 'd'.repeat(64) })
        .returning()
      if (!region) throw new Error('region not inserted')
      const [row] = await database.db
        .insert(recognitions)
        .values({
          regionId: region.id,
          source: 'batch',
          status: 'failed',
          errorCode: 'restarted',
          errorMessage: 'Сервер було перезапущено, спробуйте ще раз',
        })
        .returning()
      if (!row) throw new Error('recognition not inserted')
      const { app } = await createTestApp(database)
      const res = await stream(app, row.id)
      expect(parseSse(res.body)).toEqual([
        {
          event: 'failed',
          data: { code: 'restarted', message: 'Сервер було перезапущено, спробуйте ще раз' },
        },
      ])
      await app.close()
    })

    it('ends with an error when a finished recognition has no transcription', async () => {
      const [region] = await database.db
        .insert(regions)
        .values({ x: 0, y: 0, w: 1, h: 1, imageHash: 'e'.repeat(64) })
        .returning()
      if (!region) throw new Error('region not inserted')
      const [row] = await database.db
        .insert(recognitions)
        .values({ regionId: region.id, source: 'batch', status: 'done' })
        .returning()
      if (!row) throw new Error('recognition not inserted')
      const { app } = await createTestApp(database)
      const res = await stream(app, row.id)
      expect(parseSse(res.body).at(-1)?.event).toBe('failed')
      await app.close()
    })

    it('closes open streams when the server shuts down', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, { reader: recorder.reader })
      const created = await post(app, recognitionBody(nextPng()))
      await waitUntil(() => recorder.inputs.length === 1)
      const pending = stream(app, created.json().recognitionId)
      await sleep(50)

      const closed = await Promise.race([
        app.close().then(() => 'closed'),
        sleep(2000).then(() => 'hung'),
      ])
      expect(closed).toBe('closed')
      const res = await pending
      expect(res.statusCode).toBe(200)
      recorder.release()
      await queue.onIdle()
    })

    it('stops a stream that outlives its maximum lifetime without inventing a result', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await createTestApp(database, {
        reader: recorder.reader,
        maxStreamMs: 60,
      })
      const created = await post(app, recognitionBody(nextPng()))
      await waitUntil(() => recorder.inputs.length === 1)
      const res = await stream(app, created.json().recognitionId)
      expect(parseSse(res.body).map((e) => e.event)).toEqual(['progress'])
      recorder.release()
      await queue.onIdle()
      await app.close()
    })
  })

  describe('restart recovery', () => {
    const recognitionIn = async (status: 'queued' | 'reading' | 'normalizing', ageMs: number) => {
      const [region] = await database.db
        .insert(regions)
        .values({ x: 0, y: 0, w: 1, h: 1, imageHash: String(Math.random()).padEnd(64, '0') })
        .returning()
      const [row] = await database.db
        .insert(recognitions)
        .values({
          regionId: region?.id ?? '',
          source: 'batch',
          status,
          createdAt: new Date(Date.now() - ageMs),
        })
        .returning()
      return row?.id ?? ''
    }

    it('closes stale recognitions in every active status and leaves fresh ones alone', async () => {
      await resetDatabase(database)
      const stale = await Promise.all(
        (['queued', 'reading', 'normalizing'] as const).map((status) =>
          recognitionIn(status, 60 * 60_000),
        ),
      )
      const runningElsewhere = await recognitionIn('reading', 1000)
      expect(await failStaleRecognitions(database.db, { code: 'restarted' })).toBe(3)

      const rows = await database.db
        .select({ id: recognitions.id, status: recognitions.status, code: recognitions.errorCode })
        .from(recognitions)
      expect(rows.filter((row) => stale.includes(row.id)).map((row) => row.code)).toEqual([
        'restarted',
        'restarted',
        'restarted',
      ])
      expect(rows.find((row) => row.id === runningElsewhere)?.status).toBe('reading')
    })

    it('closes its own unfinished recognitions on shutdown and tells their streams', async () => {
      await resetDatabase(database)
      const recorder = createRecordingReader({ gated: true })
      const { app, hub, queue } = await createTestApp(database, { reader: recorder.reader })
      const ids = await Promise.all(
        [1, 2, 3].map(
          async () => (await post(app, recognitionBody(nextPng()))).json().recognitionId,
        ),
      )
      await waitUntil(() => recorder.inputs.length === 2)
      const failed: string[] = []
      for (const id of ids) {
        hub.subscribe(id, (event) => {
          if (event.event === 'failed' && event.data.code === 'restarted') failed.push(id)
        })
      }

      const closed = await closeOwnRecognitions({ db: database.db, hub, queue, drainMs: 20 })

      expect(closed).toEqual({ dropped: 1, cut: 2 })
      expect(await activeCount()).toBe(0)
      expect(failed.sort()).toEqual([...ids].sort())
      recorder.release()
      await queue.onIdle()
      expect(await activeCount()).toBe(0)
      await app.close()
    })

    it('does not leave active rows behind after a normal run', async () => {
      await resetDatabase(database)
      const { app, queue } = await createTestApp(database)
      await post(app, recognitionBody(nextPng()))
      await queue.onIdle()
      expect(await activeCount()).toBe(0)
      expect(queue.backlog()).toBe(0)
      await app.close()
    })
  })
})

import {
  recognitionStateSchema,
  transcriptionSchema,
  type RecognitionEvent,
  type Transcription,
} from '@khronist/contracts'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { recognitions, transcriptions } from '../src/db/schema.ts'
import { failRecognitions } from '../src/jobs/recognize.ts'
import { renormalizeVersion } from '../src/jobs/renormalize.ts'
import { noEntities, placeEntities, type EntityExtractor } from '../src/services/entities.ts'
import {
  parseOutput,
  withCallBudget,
  type CallBudget,
  type LlmProvider,
} from '../src/services/llm/index.ts'
import { passthroughNormalizer, type Normalizer } from '../src/services/normalize.ts'
import {
  insertTranscriptionVersion,
  loadLines,
  loadTranscription,
} from '../src/services/transcriptions.ts'
import { createLlmTranslator, type Translator } from '../src/services/translate.ts'
import {
  createTestApp,
  createTestDatabase,
  dropHardSigns,
  makePng,
  recognitionBody,
  resetDatabase,
  signIn,
  silentLog,
  unlimitedBudget,
  type TestAppOptions,
  type TestDatabase,
} from './helpers.ts'

let size = 100
const nextPng = () => makePng((size += 1), 200)

let database: TestDatabase
const codes = new Map<string, string>()

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

beforeEach(async () => {
  codes.clear()
  await resetDatabase(database)
})

const ukrainian = (line: string) => `укр. ${line}`

const unusedModel = () => {
  const calls: unknown[] = []
  const model: LlmProvider = {
    name: 'claude-test',
    complete: async (request) => {
      calls.push(request)
      throw new Error('the model must not be called')
    },
  }
  return { model, calls }
}

const answeringModel = (answer: unknown): LlmProvider => ({
  name: 'claude-test',
  complete: async (request) => ({
    value: parseOutput(JSON.stringify(answer), request.schema),
    model: 'claude-test',
    usage: { inputTokens: 1, outputTokens: 1 },
  }),
})

const translating = (): Translator & { inputs: Parameters<Translator['translate']>[0][] } => {
  const inputs: Parameters<Translator['translate']>[0][] = []
  return {
    inputs,
    translate: async (input) => {
      inputs.push(input)
      return { lines: input.lines.map(ukrainian) }
    },
  }
}

const readWith = async (options: TestAppOptions, extra: Record<string, unknown> = {}) => {
  const created = await createTestApp(database, options)
  const posted = await created.app.inject({
    method: 'POST',
    url: '/v1/recognitions',
    payload: recognitionBody(nextPng(), extra),
  })
  await created.queue.onIdle()
  const state = await created.app.inject({
    method: 'GET',
    url: `/v1/recognitions/${posted.json().recognitionId}`,
  })
  const parsed = recognitionStateSchema.parse(state.json())
  return { ...created, state: parsed }
}

const transcriptionOf = (state: { transcription?: Transcription | undefined }) => {
  if (!state.transcription) throw new Error('the reading saved no transcription')
  return state.transcription
}

const storedTranslation = async (id: string) => {
  const [row] = await database.db
    .select({ translatedLines: transcriptions.translatedLines })
    .from(transcriptions)
    .where(eq(transcriptions.id, id))
  return row?.translatedLines
}

describe('translation during reading', () => {
  it('saves the translation of the normalized lines and returns it from both routes', async () => {
    const translator = translating()
    const { app, state } = await readWith(
      { normalizer: dropHardSigns, translator },
      { hints: { language: 'ru', period: '19' } },
    )
    const transcription = transcriptionOf(state)
    const modern = transcription.normalizedLines?.map((line) => line.text) ?? []
    expect(modern[0]).toBe('Села Борщаговки крестьянин Іоанн Петров Коваленко')
    expect(translator.inputs).toHaveLength(1)
    expect(translator.inputs[0]?.lines).toEqual(modern)
    expect(translator.inputs[0]?.hints).toEqual({ language: 'ru', period: '19' })
    expect(transcription.translatedLines).toEqual(modern.map(ukrainian))
    const read = await app.inject({ method: 'GET', url: `/v1/transcriptions/${transcription.id}` })
    expect(transcriptionSchema.parse(read.json()).translatedLines).toEqual(modern.map(ukrainian))
    await app.close()
  })

  it('does not translate when the lines were not normalized', async () => {
    const translator = translating()
    const failing: Normalizer = {
      normalize: async () => {
        throw new Error('normalization is down')
      },
    }
    for (const normalizer of [passthroughNormalizer, failing]) {
      const { app, state } = await readWith({ normalizer, translator })
      expect(state.status).toBe('done')
      expect(transcriptionOf(state).translatedLines).toBeUndefined()
      await app.close()
    }
    expect(translator.inputs).toHaveLength(0)
  })

  it('leaves the key out for a version stored without a translation', async () => {
    const { app, state } = await readWith({ normalizer: dropHardSigns, translator: translating() })
    const { id } = transcriptionOf(state)
    await database.db
      .update(transcriptions)
      .set({ translatedLines: null })
      .where(eq(transcriptions.id, id))
    expect(await storedTranslation(id)).toBeNull()

    const read = await app.inject({ method: 'GET', url: `/v1/transcriptions/${id}` })
    expect(read.statusCode).toBe(200)
    expect(read.json()).not.toHaveProperty('translatedLines')
    expect(read.json()).toHaveProperty('normalizedLines')
    expect(transcriptionSchema.safeParse(read.json()).success).toBe(true)
    const recognition = await app.inject({
      method: 'GET',
      url: `/v1/recognitions/${state.recognitionId}`,
    })
    expect(recognition.json().transcription).not.toHaveProperty('translatedLines')
    expect(recognitionStateSchema.safeParse(recognition.json()).success).toBe(true)
    await app.close()
  })

  it('leaves out a stored translation that does not fit the lines instead of failing', async () => {
    const { app, state } = await readWith({ normalizer: dropHardSigns, translator: translating() })
    const { id } = transcriptionOf(state)
    for (const misfit of [['одна'], ['а', 'б', 'в', 'г'], ['а'.repeat(501), 'б', 'в']]) {
      await database.db
        .update(transcriptions)
        .set({ translatedLines: misfit })
        .where(eq(transcriptions.id, id))
      const read = await app.inject({ method: 'GET', url: `/v1/transcriptions/${id}` })
      expect(read.statusCode).toBe(200)
      expect(read.json()).not.toHaveProperty('translatedLines')
      expect(transcriptionSchema.safeParse(read.json()).success).toBe(true)
    }
    await app.close()
  })

  it('warns once per read when it leaves out a stored translation of the wrong shape', async () => {
    const { app, state } = await readWith({ normalizer: dropHardSigns, translator: translating() })
    await app.close()
    const { id } = transcriptionOf(state)
    const stored = [sql`'"абв"'::jsonb`, sql`'["а", 2, "в"]'::jsonb`, sql`'{"0": "а"}'::jsonb`]
    for (const misfit of stored) {
      await database.db
        .update(transcriptions)
        .set({ translatedLines: misfit })
        .where(eq(transcriptions.id, id))
      const warnings: object[] = []
      const read = await loadTranscription(database.db, id, {
        warn: (details) => void warnings.push(details),
      })
      expect(read?.translatedLines).toBeUndefined()
      expect(warnings).toEqual([{ transcriptionId: id }])
    }
    await database.db
      .update(transcriptions)
      .set({ translatedLines: null })
      .where(eq(transcriptions.id, id))
    const warnings: object[] = []
    await loadTranscription(database.db, id, { warn: (details) => void warnings.push(details) })
    expect(warnings).toEqual([])
  })

  it('does not call the model for a fragment in another language', async () => {
    const { model, calls } = unusedModel()
    const { app, state } = await readWith(
      { normalizer: dropHardSigns, translator: createLlmTranslator(model) },
      { hints: { language: 'uk' } },
    )
    expect(transcriptionOf(state).translatedLines).toBeUndefined()
    expect(calls).toHaveLength(0)
    await app.close()
  })

  it('keeps the reading without a translation when it fails, breaks the rules or is late', async () => {
    const broken: Translator[] = [
      {
        translate: async () => {
          throw new Error('translation is down')
        },
      },
      createLlmTranslator(answeringModel({ lines: ['Села Борщагівки'] })),
      createLlmTranslator(answeringModel({ lines: ['', ' ', ''] })),
      createLlmTranslator(answeringModel({ lines: ['Села\u0000', 'і', 'обоє'] })),
      { translate: () => new Promise(() => {}) },
    ]
    const findsKovalenko: EntityExtractor = {
      extract: async ({ normalizedText }) =>
        placeEntities(normalizedText, [
          { type: 'person', text: 'Коваленко', normalized: 'Коваленко' },
        ]).placed,
    }
    for (const translator of broken) {
      const { app, state } = await readWith({
        normalizer: dropHardSigns,
        entities: findsKovalenko,
        translator,
        translateTimeoutMs: 30,
      })
      expect(state.status).toBe('done')
      const transcription = transcriptionOf(state)
      expect(transcription.normalizedLines).toHaveLength(3)
      expect(transcription.entities).toHaveLength(1)
      expect(transcription.translatedLines).toBeUndefined()
      expect(await storedTranslation(transcription.id)).toBeNull()
      await app.close()
    }
  })

  it('skips the translation without failing the reading when the model budget is spent', async () => {
    const { model, calls } = unusedModel()
    const spent: CallBudget = { spend: async () => false, available: async () => false }
    const translator = createLlmTranslator(withCallBudget(model, spent))
    const { app, state } = await readWith({ normalizer: dropHardSigns, translator })
    expect(state.status).toBe('done')
    expect(transcriptionOf(state).translatedLines).toBeUndefined()
    expect(calls).toHaveLength(0)
    await app.close()
  })

  it('translates with the model through the same pipeline', async () => {
    const model = answeringModel({
      lines: [
        'Села Борщагівки селянин Іван Петрович Коваленко',
        'і законна дружина його Марія Григорівна',
        'обоє православного віросповідання',
      ],
    })
    const { app, state } = await readWith({
      normalizer: dropHardSigns,
      translator: createLlmTranslator(model),
    })
    expect(transcriptionOf(state).translatedLines?.[0]).toBe(
      'Села Борщагівки селянин Іван Петрович Коваленко',
    )
    await app.close()
  })

  it('runs the translation alongside the entities, not after them', async () => {
    let translationStarted = () => {}
    const started = new Promise<void>((resolve) => {
      translationStarted = resolve
    })
    const waitsForTranslation: EntityExtractor = {
      extract: async ({ normalizedText }) => {
        await started
        return placeEntities(normalizedText, [
          { type: 'person', text: 'Коваленко', normalized: 'Коваленко' },
        ]).placed
      },
    }
    const translator = translating()
    const signalling: Translator = {
      translate: async (input) => {
        translationStarted()
        return translator.translate(input)
      },
    }
    const { app, state } = await readWith({
      normalizer: dropHardSigns,
      entities: waitsForTranslation,
      translator: signalling,
      entitiesTimeoutMs: 500,
    })
    expect(transcriptionOf(state).entities).toHaveLength(1)
    expect(transcriptionOf(state).translatedLines).toHaveLength(3)
    await app.close()
  })

  it('saves nothing when the server stops the job while it finds entities and translates', async () => {
    let stopJob = () => {}
    const stopping: EntityExtractor = {
      extract: async () => {
        stopJob()
        return []
      },
    }
    const translator = translating()
    const created = await createTestApp(database, {
      normalizer: dropHardSigns,
      entities: stopping,
      translator,
    })
    stopJob = () => created.queue.abort(created.queue.running())
    const posted = await created.app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(nextPng()),
    })
    const id: string = posted.json().recognitionId
    const events: RecognitionEvent[] = []
    created.hub.subscribe(id, (event) => events.push(event))
    await created.queue.onIdle()

    expect(events.filter((event) => event.event === 'failed' || event.event === 'done')).toEqual([])
    expect(await failRecognitions(database.db, [id], 'restarted')).toEqual([id])
    const state = await created.app.inject({ method: 'GET', url: `/v1/recognitions/${id}` })
    expect(state.json().status).toBe('failed')
    expect(state.json().error.code).toBe('restarted')
    expect(state.json().transcription).toBeUndefined()
    expect(await database.db.select({ id: transcriptions.id }).from(transcriptions)).toEqual([])
    await created.app.close()
  })

  it('does not translate when the recognition is closed during normalization', async () => {
    const translator = translating()
    const closing: Normalizer = {
      normalize: async (input) => {
        await database.db
          .update(recognitions)
          .set({ status: 'failed', errorCode: 'restarted', finishedAt: new Date() })
          .where(inArray(recognitions.status, ['queued', 'reading', 'normalizing']))
        return dropHardSigns.normalize(input)
      },
    }
    const { app, state } = await readWith({ normalizer: closing, translator })
    expect(state.status).toBe('failed')
    expect(translator.inputs).toHaveLength(0)
    await app.close()
  })
})

describe('translation after an edit', () => {
  const editor = 'editor@khronist.example'

  const deps = (translator: Translator, budget: CallBudget = unlimitedBudget) => ({
    db: database.db,
    normalizer: dropHardSigns,
    entities: noEntities,
    translator,
    budget,
    log: silentLog,
  })

  it('drops the translation of the base version and translates the edit again', async () => {
    const translator = translating()
    const { app, state } = await readWith({
      normalizer: dropHardSigns,
      translator,
      signIn: { codes },
    })
    const first = transcriptionOf(state)
    expect(first.translatedLines).toHaveLength(3)
    const token = await signIn(app, codes, editor)

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/transcriptions/${first.id}/lines`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseVersion: 1, lines: [{ idx: 0, text: 'Села Борщаговки крестьянинъ Іоаннъ' }] },
    })
    const edited = transcriptionSchema.parse(res.json())
    expect(edited.version).toBe(2)
    expect(edited.translatedLines).toBeUndefined()
    expect(edited.normalizedLines).toBeUndefined()
    await app.close()

    await renormalizeVersion(deps(translator), edited.id)
    const again = await storedTranslation(edited.id)
    expect(again?.[0]).toBe(ukrainian('Села Борщаговки крестьянин Іоанн'))
    expect(again?.slice(1)).toEqual(first.translatedLines?.slice(1))
    expect(await storedTranslation(first.id)).toEqual(first.translatedLines)
  })

  const editedVersion = async () => {
    const { app, state } = await readWith({ normalizer: dropHardSigns, signIn: { codes } })
    const first = transcriptionOf(state)
    const token = await signIn(app, codes, editor)
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/transcriptions/${first.id}/lines`,
      headers: { authorization: `Bearer ${token}` },
      payload: { baseVersion: 1, lines: [{ idx: 2, text: 'оба православные' }] },
    })
    await app.close()
    const { id } = transcriptionSchema.parse(res.json())
    await database.db
      .update(transcriptions)
      .set({ normalizedLines: null, translatedLines: null })
      .where(eq(transcriptions.id, id))
    return id
  }

  const normalizedLinesOf = async (id: string) => {
    const [row] = await database.db
      .select({ normalizedLines: transcriptions.normalizedLines })
      .from(transcriptions)
      .where(eq(transcriptions.id, id))
    return row?.normalizedLines
  }

  const secondCheck = (answer: () => Promise<boolean>) => {
    let checks = 0
    const budget: CallBudget = {
      spend: async () => true,
      available: async () => {
        checks += 1
        return checks === 1 || answer()
      },
    }
    return { budget, checks: () => checks }
  }

  it.each([
    ['is kept for readings', async () => false],
    [
      'cannot be read',
      async () => {
        throw new Error('the budget table is down')
      },
    ],
  ])(
    'saves the edit with entities but without a translation when the budget %s',
    async (_case, answer) => {
      const id = await editedVersion()
      const { budget, checks } = secondCheck(answer)
      const translator = translating()
      const findsKovalenko: EntityExtractor = {
        extract: async ({ normalizedText }) =>
          placeEntities(normalizedText, [
            { type: 'person', text: 'Коваленко', normalized: 'Коваленко' },
          ]).placed,
      }
      const warnings: string[] = []
      const log = {
        ...silentLog,
        warn: (_: object, message: string) => void warnings.push(message),
      }
      const outcome = await renormalizeVersion(
        {
          ...deps(translator, budget),
          entities: findsKovalenko,
          log: { ...log, child: () => log },
        },
        id,
      )
      expect(outcome).toBe('normalized')
      expect(checks()).toBe(2)
      expect(translator.inputs).toHaveLength(0)
      expect(await normalizedLinesOf(id)).toHaveLength(3)
      expect(await storedTranslation(id)).toBeNull()
      expect((await loadTranscription(database.db, id, silentLog))?.entities).toHaveLength(1)
      expect(warnings).toEqual([
        'the rest of the model budget is kept for readings, skipping the translation',
      ])
    },
  )

  it('does not write a version that an edit committed before the save replaced', async () => {
    const id = await editedVersion()
    const [edited] = await database.db
      .select({ regionId: transcriptions.regionId })
      .from(transcriptions)
      .where(eq(transcriptions.id, id))
    const editingMeanwhile: Translator = {
      translate: async ({ lines }) => {
        await insertTranscriptionVersion(database.db, {
          regionId: edited?.regionId ?? '',
          reader: 'edit',
          lines: await loadLines(database.db, id),
          warnings: [],
          normalized: null,
          translatedLines: null,
          entities: [],
        })
        return { lines: lines.map(ukrainian) }
      },
    }
    expect(await renormalizeVersion(deps(editingMeanwhile), id)).toBe('skipped')
    expect(await normalizedLinesOf(id)).toBeNull()
    expect(await storedTranslation(id)).toBeNull()
  })

  it('saves the new normalization without a translation when the translation fails', async () => {
    const id = await editedVersion()
    const failing: Translator = {
      translate: async () => {
        throw new Error('translation is down')
      },
    }
    expect(await renormalizeVersion(deps(failing), id)).toBe('normalized')
    expect(await storedTranslation(id)).toBeNull()
  })

  it('writes nothing when the work is stopped while it translates', async () => {
    const id = await editedVersion()
    const stopping = new AbortController()
    const stopper: Translator = {
      translate: async () => {
        stopping.abort(new Error('the server is shutting down'))
        return new Promise(() => {})
      },
    }
    await expect(renormalizeVersion(deps(stopper), id, stopping.signal)).rejects.toThrow(
      /shutting down/,
    )
    expect(await normalizedLinesOf(id)).toBeNull()
  })
})

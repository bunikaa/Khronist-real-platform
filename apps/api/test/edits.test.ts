import {
  htrVisionOutputSchema,
  maxHistoryEdits,
  maxPatchedLines,
  transcriptionHistorySchema,
  transcriptionSchema,
  versionConflictSchema,
  visionToLines,
  type Line,
  type PatchLinesRequest,
  type Transcription,
} from '@khronist/contracts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { edits as editRows, transcriptions } from '../src/db/schema.ts'
import { recordEditsPerMinute, recordReadsPerMinute } from '../src/lib/limits.ts'
import { editedLine } from '../src/services/edits.ts'
import { placeEntities, type EntityExtractor } from '../src/services/entities.ts'
import { createFixtureReader } from '../src/services/htr/fixture.ts'
import type { HtrReader } from '../src/services/htr/index.ts'
import {
  createTestApp,
  createTestDatabase,
  dropHardSigns,
  makePng,
  recognitionBody,
  resetDatabase,
  signIn,
  sleep,
  type TestAppOptions,
  type TestDatabase,
} from './helpers.ts'

const editor = 'editor@khronist.example'
const verifier = 'historian@khronist.example'
const unknownId = '0190a000-0000-7000-8000-000000000000'
const editedSecondLine = 'и законная жена его Марія Григорьева'

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

type Created = Awaited<ReturnType<typeof createTestApp>>
type App = Created['app']

const start = (options: TestAppOptions = {}) =>
  createTestApp(database, { signIn: { codes, verifierEmails: [verifier] }, ...options })

const read = async ({ app, queue }: Created): Promise<Transcription> => {
  const created = await app.inject({
    method: 'POST',
    url: '/v1/recognitions',
    payload: recognitionBody(nextPng()),
  })
  await queue.onIdle()
  const state = await app.inject({
    method: 'GET',
    url: `/v1/recognitions/${created.json().recognitionId}`,
  })
  return transcriptionSchema.parse(state.json().transcription)
}

const authorization = (token: string | undefined) =>
  token === undefined ? {} : { authorization: `Bearer ${token}` }

const patchLines = (
  app: App,
  id: string,
  token: string | undefined,
  payload: PatchLinesRequest | string,
) =>
  app.inject({
    method: 'PATCH',
    url: `/v1/transcriptions/${id}/lines`,
    headers: { ...authorization(token), 'content-type': 'application/json' },
    payload,
  })

const verify = (app: App, id: string, token: string | undefined, payload: object = {}) =>
  app.inject({
    method: 'POST',
    url: `/v1/transcriptions/${id}/verify`,
    headers: authorization(token),
    payload,
  })

const history = (app: App, id: string) =>
  app.inject({ method: 'GET', url: `/v1/transcriptions/${id}/history` })

const getTranscription = async (app: App, id: string) =>
  transcriptionSchema.parse(
    (await app.inject({ method: 'GET', url: `/v1/transcriptions/${id}` })).json(),
  )

const normalizedLater = async (app: App, id: string): Promise<Transcription> => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await database.db
      .select({ normalizedLines: transcriptions.normalizedLines })
      .from(transcriptions)
      .where(eq(transcriptions.id, id))
    if (row?.normalizedLines) return getTranscription(app, id)
    await sleep(10)
  }
  throw new Error('the edited version was not normalized again')
}

const editSecondLine = { baseVersion: 1, lines: [{ idx: 1, text: editedSecondLine }] }

const manyLines: HtrReader = {
  kind: 'fixture',
  read: async () => ({
    lines: visionToLines(
      htrVisionOutputSchema.parse({
        lines: Array.from({ length: maxPatchedLines }, (_, i) => ({
          text: `рядок ${i}`,
          words: [
            { text: 'рядок', uncertain: false },
            { text: String(i), uncertain: false },
          ],
        })),
      }),
    ),
    warnings: [],
    reader: 'many-lines',
  }),
}

describe('editedLine', () => {
  const line: Line = {
    idx: 2,
    text: 'старый текстъ',
    box: { x: 0, y: 0.5, w: 1, h: 0.25 },
    boxSource: 'estimated',
    uncertain: true,
    words: [
      { text: 'старый', uncertain: true },
      { text: 'текстъ', uncertain: false },
    ],
  }

  it.each([
    ['Іоаннъ Петровъ', ['Іоаннъ', 'Петровъ']],
    ['  Іоаннъ   Петровъ  ', ['Іоаннъ', 'Петровъ']],
    ['Іоаннъ\tПетровъ', ['Іоаннъ', 'Петровъ']],
    ['', []],
  ])('turns %j into certain words %j and keeps the place of the line', (text, words) => {
    expect(editedLine(line, text)).toEqual({
      idx: 2,
      text,
      box: line.box,
      boxSource: 'estimated',
      uncertain: false,
      words: words.map((word) => ({ text: word, uncertain: false })),
    })
  })
})

describe('PATCH /v1/transcriptions/:id/lines', () => {
  it('saves the edit as a new draft version by the editor', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, editSecondLine)

    expect(res.statusCode).toBe(200)
    const edited = transcriptionSchema.parse(res.json())
    expect(edited.id).not.toBe(first.id)
    expect(edited).toMatchObject({ regionId: first.regionId, version: 2, status: 'draft' })
    expect(edited.author).toBeDefined()
    expect(edited.lines[0]).toEqual(first.lines[0])
    expect(edited.lines[1]).toEqual(editedLine(first.lines[1] as Line, editedSecondLine))
    expect(edited.lines[2]).toEqual(first.lines[2])
    expect(edited.normalizedText).toBe(edited.lines.map((line) => line.text).join('\n'))
    expect(await getTranscription(created.app, first.id)).toEqual(first)
    await created.app.close()
  })

  it('drops the entities of the base version and keeps its warnings and reader', async () => {
    const warned: HtrReader = {
      kind: 'fixture',
      read: async (input) => ({
        ...(await createFixtureReader().read(input)),
        warnings: ['cut_off_left'],
        reader: 'warned-fixture',
      }),
    }
    const findsKovalenko: EntityExtractor = {
      extract: async ({ normalizedText }) =>
        placeEntities(normalizedText, [
          { type: 'person', text: 'Коваленко', normalized: 'Коваленко' },
        ]).placed,
    }
    const created = await start({ reader: warned, entities: findsKovalenko })
    const first = await read(created)
    expect(first.entities).toHaveLength(1)
    expect(first.warnings).toEqual(['cut_off_left'])
    const token = await signIn(created.app, codes, editor)

    const edited = transcriptionSchema.parse(
      (await patchLines(created.app, first.id, token, editSecondLine)).json(),
    )

    expect(edited.entities).toEqual([])
    expect(edited.warnings).toEqual(['cut_off_left'])
    expect(edited.reader).toBe('warned-fixture')
    await created.app.close()
  })

  it('keeps the words and marks of a sent line whose text did not change', async () => {
    const created = await start()
    const first = await read(created)
    const uncertainLine = first.lines[1] as Line
    expect(uncertainLine.uncertain).toBe(true)
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [
        { idx: 1, text: uncertainLine.text },
        { idx: 0, text: 'Села Борщаговки крестьянин' },
      ],
    })

    expect(res.statusCode).toBe(200)
    const edited = transcriptionSchema.parse(res.json())
    expect(edited.lines[1]).toEqual(uncertainLine)
    expect(edited.lines[0]).toEqual(
      editedLine(first.lines[0] as Line, 'Села Борщаговки крестьянин'),
    )
    const { edits } = transcriptionHistorySchema.parse(
      (await history(created.app, first.id)).json(),
    )
    expect(edits.map((edit) => edit.lineIdx)).toEqual([0])
    await created.app.close()
  })

  it('saves the largest edit the contract allows', async () => {
    const created = await start({ reader: manyLines })
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)
    const longLine = Array.from({ length: 250 }, () => 'ѣ').join(' ')

    const res = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: first.lines.map((line) => ({ idx: line.idx, text: longLine })),
    })

    expect(res.statusCode).toBe(200)
    const edited = transcriptionSchema.parse(res.json())
    expect(edited.lines).toHaveLength(maxPatchedLines)
    expect(edited.lines.every((line) => line.words.length === 250)).toBe(true)
    await created.app.close()
  })

  it('makes a new draft over a verified version and keeps the verified one', async () => {
    const created = await start()
    const first = await read(created)
    const verified = transcriptionSchema.parse(
      (await verify(created.app, first.id, await signIn(created.app, codes, verifier))).json(),
    )
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, editSecondLine)

    expect(res.statusCode).toBe(200)
    expect(transcriptionSchema.parse(res.json())).toMatchObject({ version: 2, status: 'draft' })
    expect(await getTranscription(created.app, first.id)).toEqual(verified)
    await created.app.close()
  })

  it('normalizes the edited version again in the background', async () => {
    const created = await start({ normalizer: dropHardSigns })
    const first = await read(created)
    expect(first.normalizedLines).toBeDefined()
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, editSecondLine)
    const edited = transcriptionSchema.parse(res.json())
    expect(edited.normalizedLines).toBeUndefined()

    const normalized = await normalizedLater(created.app, edited.id)
    expect(normalized.normalizedText).toBe(
      'Села Борщаговки крестьянин Іоанн Петров Коваленко\n' +
        `${editedSecondLine}\n` +
        'оба православнаго исповѣданія',
    )
    await created.app.close()
  })

  it('returns the current version and creates no new one when nothing changed', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [{ idx: 0, text: first.lines[0]?.text ?? '' }],
    })

    expect(res.statusCode).toBe(200)
    expect(transcriptionSchema.parse(res.json())).toEqual(first)
    expect((await history(created.app, first.id)).json()).toEqual({ edits: [] })
    await created.app.close()
  })

  it('answers 401 without a session, before reading the body', async () => {
    const created = await start()
    const first = await read(created)

    const missing = await patchLines(created.app, first.id, undefined, editSecondLine)
    const wrong = await patchLines(created.app, first.id, 'not-a-session', editSecondLine)
    const invalidBody = await patchLines(created.app, first.id, undefined, '{"lines":')

    for (const res of [missing, wrong, invalidBody]) {
      expect(res.statusCode).toBe(401)
      expect(res.json().error.code).toBe('unauthorized')
    }
    await created.app.close()
  })

  it('answers 400 for a line the version does not have', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [{ idx: 3, text: 'лишняя строка' }],
    })

    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    expect((await history(created.app, first.id)).json()).toEqual({ edits: [] })
    await created.app.close()
  })

  it('answers 400 for a body outside the contract', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const repeated = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [
        { idx: 1, text: 'а' },
        { idx: 1, text: 'б' },
      ],
    })
    const broken = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [{ idx: 1, text: 'два\nрядки' }],
    })
    const withNul = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [{ idx: 1, text: 'и законная\u0000жена' }],
    })
    const withLoneSurrogate = await patchLines(created.app, first.id, token, {
      baseVersion: 1,
      lines: [{ idx: 1, text: 'и законная \uD800жена' }],
    })

    for (const res of [repeated, broken, withNul, withLoneSurrogate]) {
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('bad_request')
    }
    await created.app.close()
  })

  it('answers 404 for an unknown transcription', async () => {
    const created = await start()
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(created.app, unknownId, token, editSecondLine)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    await created.app.close()
  })

  it('answers 409 with the latest version for a stale base version or an older id', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)
    const second = transcriptionSchema.parse(
      (await patchLines(created.app, first.id, token, editSecondLine)).json(),
    )
    const edit = { baseVersion: 1, lines: [{ idx: 0, text: 'другая правка' }] }

    const staleBase = await patchLines(created.app, second.id, token, edit)
    const olderId = await patchLines(created.app, first.id, token, edit)

    for (const res of [staleBase, olderId]) {
      expect(res.statusCode).toBe(409)
      const conflict = versionConflictSchema.parse(res.json())
      expect(conflict.error.code).toBe('version_conflict')
      expect(conflict.current).toEqual(second)
    }
    await created.app.close()
  })

  it('lets only one of two parallel edits of the same version through', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const answers = await Promise.all([
      patchLines(created.app, first.id, token, editSecondLine),
      patchLines(created.app, first.id, token, {
        baseVersion: 1,
        lines: [{ idx: 0, text: 'другая правка' }],
      }),
    ])

    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 409])
    await created.app.close()
  })

  it('answers 413 for a body over the limit', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const res = await patchLines(
      created.app,
      first.id,
      token,
      JSON.stringify({ baseVersion: 1, lines: [{ idx: 0, text: 'ѣ'.repeat(140_000) }] }),
    )

    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('too_large')
    await created.app.close()
  })

  it('answers 429 once the edits of a minute are spent, apart from verification', async () => {
    const { app } = await start()
    for (let sent = 0; sent < recordEditsPerMinute; sent += 1) {
      expect((await patchLines(app, unknownId, undefined, editSecondLine)).statusCode).toBe(401)
    }

    const limited = await patchLines(app, unknownId, undefined, editSecondLine)

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    expect(limited.headers['retry-after']).toBeDefined()
    expect((await verify(app, unknownId, undefined)).statusCode).toBe(401)
    await app.close()
  })
})

describe('POST /v1/transcriptions/:id/verify', () => {
  it('verifies the latest version with the signature of the verifier', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, verifier)

    const res = await verify(created.app, first.id, token, { signature: ' Олена К., історикиня ' })

    expect(res.statusCode).toBe(200)
    const verified = transcriptionSchema.parse(res.json())
    expect(verified).toMatchObject({
      id: first.id,
      version: 1,
      status: 'verified',
      verifiedSignature: 'Олена К., історикиня',
    })
    expect(verified.verifiedBy).toBeDefined()
    expect(verified.verifiedAt).toBeDefined()
    expect(await getTranscription(created.app, first.id)).toEqual(verified)
    await created.app.close()
  })

  it('verifies without a signature and compares addresses without case', async () => {
    const created = await start({
      signIn: { codes, verifierEmails: ['Historian@Khronist.Example'] },
    })
    const first = await read(created)
    const token = await signIn(created.app, codes, verifier)

    const res = await verify(created.app, first.id, token)

    expect(res.statusCode).toBe(200)
    const verified = transcriptionSchema.parse(res.json())
    expect(verified.status).toBe('verified')
    expect(verified.verifiedSignature).toBeUndefined()
    await created.app.close()
  })

  it('keeps the first verification when the version is verified again', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, verifier)
    const once = transcriptionSchema.parse(
      (await verify(created.app, first.id, token, { signature: 'Перша' })).json(),
    )

    const again = await verify(created.app, first.id, token, { signature: 'Друга' })

    expect(again.statusCode).toBe(200)
    expect(transcriptionSchema.parse(again.json())).toEqual(once)
    await created.app.close()
  })

  it('answers 403 to a signed-in address outside the verifiers', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)

    const res = await verify(created.app, first.id, token)

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
    expect((await getTranscription(created.app, first.id)).status).toBe('draft')
    await created.app.close()
  })

  it('answers 403 to everyone when no verifiers are configured', async () => {
    const created = await start({ signIn: { codes, verifierEmails: [] } })
    const first = await read(created)
    const token = await signIn(created.app, codes, verifier)

    const res = await verify(created.app, first.id, token)

    expect(res.statusCode).toBe(403)
    expect(res.json().error.code).toBe('forbidden')
    await created.app.close()
  })

  it('answers 401 without a session', async () => {
    const created = await start()
    const first = await read(created)

    const res = await verify(created.app, first.id, undefined)

    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthorized')
    await created.app.close()
  })

  it('answers 400 for a signature outside the contract', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, verifier)

    for (const signature of ['Олена\u0007', 'Олена\uD800']) {
      const res = await verify(created.app, first.id, token, { signature })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('bad_request')
    }
    expect((await getTranscription(created.app, first.id)).status).toBe('draft')
    await created.app.close()
  })

  it('answers 404 for an unknown transcription', async () => {
    const created = await start()
    const token = await signIn(created.app, codes, verifier)

    const res = await verify(created.app, unknownId, token)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    await created.app.close()
  })

  it('answers 409 with the latest version for an older one', async () => {
    const created = await start()
    const first = await read(created)
    const editorToken = await signIn(created.app, codes, editor)
    const second = transcriptionSchema.parse(
      (await patchLines(created.app, first.id, editorToken, editSecondLine)).json(),
    )
    const token = await signIn(created.app, codes, verifier)

    const res = await verify(created.app, first.id, token)

    expect(res.statusCode).toBe(409)
    const conflict = versionConflictSchema.parse(res.json())
    expect(conflict.error.code).toBe('version_conflict')
    expect(conflict.current).toEqual(second)
    expect((await getTranscription(created.app, first.id)).status).toBe('draft')
    await created.app.close()
  })

  it('answers 429 once the verifications of a minute are spent', async () => {
    const { app } = await start()
    for (let sent = 0; sent < recordEditsPerMinute; sent += 1) {
      expect((await verify(app, unknownId, undefined)).statusCode).toBe(401)
    }

    const limited = await verify(app, unknownId, undefined)

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    await app.close()
  })
})

describe('GET /v1/transcriptions/:id/history', () => {
  it('lists the edits of every version of the region in order', async () => {
    const created = await start()
    const first = await read(created)
    const token = await signIn(created.app, codes, editor)
    const second = transcriptionSchema.parse(
      (await patchLines(created.app, first.id, token, editSecondLine)).json(),
    )
    const third = transcriptionSchema.parse(
      (
        await patchLines(created.app, second.id, token, {
          baseVersion: 2,
          lines: [
            { idx: 2, text: 'оба православного исповедания' },
            { idx: 0, text: 'Села Борщаговки крестьянин Иоанн Петров Коваленко' },
          ],
        })
      ).json(),
    )

    for (const id of [first.id, third.id]) {
      const res = await history(created.app, id)
      expect(res.statusCode).toBe(200)
      const { edits } = transcriptionHistorySchema.parse(res.json())
      expect(
        edits.map(({ version, lineIdx, before, after }) => ({ version, lineIdx, before, after })),
      ).toEqual([
        { version: 2, lineIdx: 1, before: first.lines[1]?.text, after: editedSecondLine },
        {
          version: 3,
          lineIdx: 0,
          before: first.lines[0]?.text,
          after: 'Села Борщаговки крестьянин Иоанн Петров Коваленко',
        },
        {
          version: 3,
          lineIdx: 2,
          before: first.lines[2]?.text,
          after: 'оба православного исповедания',
        },
      ])
      expect(edits.every((edit) => edit.author !== undefined)).toBe(true)
    }
    await created.app.close()
  })

  it('is public and works when sign-in is not configured', async () => {
    const created = await createTestApp(database)
    const first = await read(created)

    const res = await history(created.app, first.id)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ edits: [] })
    expect((await patchLines(created.app, first.id, undefined, editSecondLine)).statusCode).toBe(
      404,
    )
    expect((await verify(created.app, first.id, undefined)).statusCode).toBe(404)
    await created.app.close()
  })

  it.each([
    { stored: maxHistoryEdits, truncated: undefined, oldestShown: 0 },
    { stored: maxHistoryEdits + 1, truncated: true, oldestShown: 1 },
  ])(
    'returns the latest edits of $stored and says whether older ones were cut',
    async ({ stored, truncated, oldestShown }) => {
      const created = await start()
      const first = await read(created)
      await database.db.insert(editRows).values(
        Array.from({ length: stored }, (_, lineIdx) => ({
          transcriptionId: first.id,
          lineIdx,
          before: 'було',
          after: 'стало',
        })),
      )

      const res = await history(created.app, first.id)

      expect(res.statusCode).toBe(200)
      const shown = transcriptionHistorySchema.parse(res.json())
      expect(shown.truncated).toBe(truncated)
      expect(shown.edits).toHaveLength(maxHistoryEdits)
      expect(shown.edits[0]?.lineIdx).toBe(oldestShown)
      expect(shown.edits.at(-1)?.lineIdx).toBe(stored - 1)
      await created.app.close()
    },
  )

  it('answers 404 for an unknown transcription', async () => {
    const { app } = await start()

    const res = await history(app, unknownId)

    expect(res.statusCode).toBe(404)
    expect(res.json().error.code).toBe('not_found')
    await app.close()
  })

  it('answers 429 once the reads of a minute are spent', async () => {
    const { app } = await start()
    for (let sent = 0; sent < recordReadsPerMinute; sent += 1) {
      expect((await history(app, unknownId)).statusCode).toBe(404)
    }

    const limited = await history(app, unknownId)

    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    await app.close()
  })
})

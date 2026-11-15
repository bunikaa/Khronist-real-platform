import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { entities, transcriptions } from '../src/db/schema.ts'
import { createRenormalizer, renormalizeVersion } from '../src/jobs/renormalize.ts'
import type { Normalizer } from '../src/services/normalize.ts'
import { insertTranscriptionVersion, loadLines } from '../src/services/transcriptions.ts'
import {
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  resetDatabase,
  silentLog,
  type TestDatabase,
} from './helpers.ts'

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

const dropHardSign = (text: string) => text.replace(/ъ(?=\s|$)/g, '')

const dropHardSigns: Normalizer = {
  normalize: async ({ lines }) => ({
    lines: lines.map((line) => ({
      text: dropHardSign(line.text),
      words: line.words.map((word) => ({
        text: dropHardSign(word.text),
        uncertain: word.uncertain,
      })),
    })),
    expansions: [],
  }),
}

const readFirstVersion = async (normalizer?: Normalizer) => {
  const { app, queue } = await createTestApp(database, normalizer && { normalizer })
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
  await app.close()
  return state.json().transcription as { id: string; regionId: string }
}

const editVersion = async (
  first: { id: string; regionId: string },
  found: { type: 'person'; text: string; start: number; end: number }[] = [],
) => {
  const lines = await loadLines(database.db, first.id)
  const edited = lines.map((line, index) =>
    index === 0
      ? {
          ...line,
          text: `${line.text} сынъ`,
          words: [...line.words, { text: 'сынъ', uncertain: false }],
        }
      : line,
  )
  return insertTranscriptionVersion(database.db, {
    regionId: first.regionId,
    reader: 'edit',
    lines: edited,
    warnings: [],
    normalized: null,
    entities: found,
  })
}

const stored = async (id: string) => {
  const [row] = await database.db
    .select({
      normalizedText: transcriptions.normalizedText,
      normalizedLines: transcriptions.normalizedLines,
      expansions: transcriptions.expansions,
    })
    .from(transcriptions)
    .where(eq(transcriptions.id, id))
  return row
}

const deps = (normalizer: Normalizer) => ({ db: database.db, normalizer, log: silentLog })

describe('renormalizeVersion', () => {
  it('normalizes an edited version when the previous one was normalized', async () => {
    const edited = await editVersion(await readFirstVersion(dropHardSigns))
    expect((await stored(edited))?.normalizedLines).toBeNull()
    expect(await renormalizeVersion(deps(dropHardSigns), edited)).toBe('normalized')
    const row = await stored(edited)
    expect(row?.normalizedText.split('\n')[0]).toMatch(/ сын$/)
    expect(row?.normalizedText).not.toMatch(/ъ(\s|$)/m)
    expect(row?.normalizedLines?.[0]?.words.at(-1)).toEqual({ text: 'сын', uncertain: false })
    expect(row?.expansions).toEqual([])
  })

  it('normalizes only the latest of several quick edits', async () => {
    const first = await readFirstVersion(dropHardSigns)
    const second = await editVersion(first)
    const third = await editVersion({ ...first, id: second })
    const normalize = vi.fn(dropHardSigns.normalize)
    expect(await renormalizeVersion(deps({ normalize }), second)).toBe('skipped')
    expect(normalize).not.toHaveBeenCalled()
    expect(await renormalizeVersion(deps({ normalize }), third)).toBe('normalized')
    expect((await stored(third))?.normalizedText).toMatch(/ сын сын$/m)
  })

  it('drops the entities of the version, whose places no longer match the text', async () => {
    const first = await readFirstVersion(dropHardSigns)
    const edited = await editVersion(first, [{ type: 'person', text: 'Іоаннъ', start: 0, end: 6 }])
    expect(await renormalizeVersion(deps(dropHardSigns), edited)).toBe('normalized')
    const left = await database.db
      .select({ id: entities.id })
      .from(entities)
      .where(eq(entities.transcriptionId, edited))
    expect(left).toHaveLength(0)
  })

  it('keeps the lines as edited when no earlier version was normalized', async () => {
    const edited = await editVersion(await readFirstVersion())
    const normalize = vi.fn(dropHardSigns.normalize)
    expect(await renormalizeVersion(deps({ normalize }), edited)).toBe('skipped')
    expect(normalize).not.toHaveBeenCalled()
    expect((await stored(edited))?.normalizedLines).toBeNull()
  })

  it('keeps the lines as edited when the normalization breaks the contract', async () => {
    const edited = await editVersion(await readFirstVersion(dropHardSigns))
    const broken: Normalizer = { normalize: async () => ({ lines: [], expansions: [] }) }
    await expect(renormalizeVersion(deps(broken), edited)).rejects.toThrow(/0 of 3 lines/)
    expect((await stored(edited))?.normalizedLines).toBeNull()
  })

  it('does not touch a version that is already normalized', async () => {
    const first = await readFirstVersion(dropHardSigns)
    const normalize = vi.fn(dropHardSigns.normalize)
    expect(await renormalizeVersion(deps({ normalize }), first.id)).toBe('skipped')
    expect(normalize).not.toHaveBeenCalled()
  })
})

describe('createRenormalizer', () => {
  const gated = () => {
    let open: () => void = () => {}
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    const signals: AbortSignal[] = []
    const normalizer: Normalizer = {
      normalize: async (input) => {
        if (input.signal) signals.push(input.signal)
        await opened
        return dropHardSigns.normalize(input)
      },
    }
    return { normalizer, signals, open: () => open() }
  }

  it('normalizes in the background and refuses work beyond its backlog', async () => {
    const first = await readFirstVersion(dropHardSigns)
    const edited = await editVersion(first)
    const gate = gated()
    const renormalizer = createRenormalizer({ ...deps(gate.normalizer), backlog: 1 })
    expect(renormalizer.schedule(edited)).toBe(true)
    expect(renormalizer.schedule(first.id)).toBe(false)
    gate.open()
    await renormalizer.onIdle()
    expect((await stored(edited))?.normalizedLines).not.toBeNull()
  })

  it('cuts the running work on stop quietly and accepts nothing after it', async () => {
    const first = await readFirstVersion(dropHardSigns)
    const edited = await editVersion(first)
    const gate = gated()
    const warn = vi.fn()
    const info = vi.fn()
    const log = { ...silentLog, warn, info, child: () => ({ ...silentLog, warn, info }) }
    const renormalizer = createRenormalizer({ ...deps(gate.normalizer), log, concurrency: 1 })
    renormalizer.schedule(edited)
    renormalizer.schedule(first.id)
    await vi.waitFor(() => expect(gate.signals).toHaveLength(1))
    renormalizer.stop()
    expect(gate.signals[0]?.aborted).toBe(true)
    await renormalizer.onIdle()
    expect(renormalizer.schedule(edited)).toBe(false)
    expect((await stored(edited))?.normalizedLines).toBeNull()
    expect(info).toHaveBeenCalledWith(
      { dropped: 1, cut: 1 },
      'renormalization stopped, the versions keep the lines as edited',
    )
    expect(warn).not.toHaveBeenCalledWith(
      expect.anything(),
      'renormalization failed, keeping the lines as edited',
    )
  })

  it('reports a failure that is not a stop', async () => {
    const edited = await editVersion(await readFirstVersion(dropHardSigns))
    const warn = vi.fn()
    const log = { ...silentLog, warn, child: () => ({ ...silentLog, warn }) }
    const broken: Normalizer = { normalize: async () => ({ lines: [], expansions: [] }) }
    const renormalizer = createRenormalizer({ ...deps(broken), log })
    renormalizer.schedule(edited)
    await renormalizer.onIdle()
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ transcriptionId: edited }),
      'renormalization failed, keeping the lines as edited',
    )
  })
})

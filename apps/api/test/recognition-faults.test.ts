import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { recognitions, regions } from '../src/db/schema.ts'
import { passthroughNormalizer } from '../src/services/normalize.ts'
import { insertTranscriptionVersion } from '../src/services/transcriptions.ts'
import {
  createRecordingReader,
  createTestApp,
  createTestDatabase,
  makePng,
  recognitionBody,
  type TestDatabase,
} from './helpers.ts'

type Hooks = {
  beforeInsert?: () => Promise<void>
  afterInsert?: () => void
  failSelects?: () => boolean
}

const hookRecognitionInsert = (database: TestDatabase, hooks: Hooks): TestDatabase => {
  let fired = false
  const db = new Proxy(database.db, {
    get(target, prop) {
      if (prop === 'select' && hooks.failSelects?.()) throw new Error('the database went away')
      if (prop !== 'insert') {
        const value: unknown = Reflect.get(target, prop)
        return typeof value === 'function' ? value.bind(target) : value
      }
      return (table: typeof recognitions) => {
        const builder = target.insert(table)
        if (table !== recognitions || fired) return builder
        return {
          values: (row: typeof recognitions.$inferInsert) => ({
            returning: async (fields: { id: typeof recognitions.id }) => {
              fired = true
              await hooks.beforeInsert?.()
              const inserted = await builder.values(row).returning(fields)
              hooks.afterInsert?.()
              return inserted
            },
          }),
        }
      }
    },
  })
  return { ...database, db }
}

describe('recognition races and faults', () => {
  let database: TestDatabase
  let size = 500
  const nextPng = () => makePng((size += 1), 300)

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterAll(async () => {
    await database.client.close()
  })

  const regionOf = async (png: Buffer) => {
    const hash = recognitionBody(png).imageHash
    const [region] = await database.db.select().from(regions).where(eq(regions.imageHash, hash))
    if (!region) throw new Error('region not found')
    return region
  }

  it('gives the slot back and joins the winner when another request inserted first', async () => {
    const png = nextPng()
    const recorder = createRecordingReader()
    let rivalId = ''
    const hooked = hookRecognitionInsert(database, {
      beforeInsert: async () => {
        const region = await regionOf(png)
        const [rival] = await database.db
          .insert(recognitions)
          .values({ regionId: region.id, source: 'web' })
          .returning()
        rivalId = rival?.id ?? ''
      },
    })
    const { app, queue } = await createTestApp(hooked, { reader: recorder.reader })
    const res = await app.inject({ method: 'POST', url: '/v1/recognitions', payload: recognitionBody(png) })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ recognitionId: rivalId, status: 'queued' })
    expect(queue.backlog()).toBe(0)
    expect(recorder.inputs).toHaveLength(0)
    await app.close()
  })

  it('answers from the cache when another request finished the reading just before', async () => {
    const png = nextPng()
    const recorder = createRecordingReader()
    let transcriptionId = ''
    const hooked = hookRecognitionInsert(database, {
      beforeInsert: async () => {
        const region = await regionOf(png)
        const { lines, reader } = await createRecordingReader().reader.read({ image: png })
        transcriptionId = await insertTranscriptionVersion(database.db, {
          regionId: region.id,
          reader,
          lines,
          normalized: await passthroughNormalizer.normalize(lines),
        })
      },
    })
    const { app, queue } = await createTestApp(hooked, { reader: recorder.reader })
    const res = await app.inject({ method: 'POST', url: '/v1/recognitions', payload: recognitionBody(png) })
    expect(res.json()).toMatchObject({ status: 'cached', transcriptionId })
    expect(queue.backlog()).toBe(0)
    expect(recorder.inputs).toHaveLength(0)
    const [row] = await database.db
      .select({ status: recognitions.status })
      .from(recognitions)
      .where(eq(recognitions.id, res.json().recognitionId))
    expect(row?.status).toBe('done')
    await app.close()
  })

  it('leaves no slot taken and no recognition waiting forever when the database fails after the insert', async () => {
    const png = nextPng()
    let broken = false
    const hooked = hookRecognitionInsert(database, {
      afterInsert: () => {
        broken = true
      },
      failSelects: () => broken,
    })
    const faulty = await createTestApp(hooked)
    const res = await faulty.app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(png),
    })
    expect(res.statusCode).toBe(500)
    expect(faulty.queue.backlog()).toBe(0)
    broken = false
    await faulty.app.close()

    const working = await createTestApp(database)
    const retry = await working.app.inject({
      method: 'POST',
      url: '/v1/recognitions',
      payload: recognitionBody(png),
    })
    expect(retry.json().status).toBe('queued')
    await working.queue.onIdle()
    await working.app.close()
  })
})

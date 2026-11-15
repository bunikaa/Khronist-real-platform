import type {
  AdminChunksRequest,
  AdminChunksResponse,
  AdminSourcesRequest,
  AdminSourcesResponse,
  AdminSynonymsRequest,
  AdminSynonymsResponse,
} from '@khronist/contracts'
import { eq, inArray, sql } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import { chunks, sources, synonyms } from '../db/schema.ts'
import { ApiError, findPgViolation } from '../lib/errors.ts'

const excluded = (column: string) => sql.raw(`excluded.${column}`)

const lastByKey = <T>(items: T[], keyOf: (item: T) => string): T[] => [
  ...new Map(items.map((item) => [keyOf(item), item])).values(),
]

export const upsertSources = async (
  db: Database,
  request: AdminSourcesRequest,
): Promise<AdminSourcesResponse> => {
  const items = await db
    .insert(sources)
    .values(lastByKey(request.items, (item) => item.url))
    .onConflictDoUpdate({
      target: sources.url,
      set: {
        title: excluded('title'),
        licence: excluded('licence'),
        kind: excluded('kind'),
        periodFrom: excluded('period_from'),
        periodTo: excluded('period_to'),
      },
    })
    .returning({ id: sources.id, url: sources.url })
  return { items }
}

type ChunkItem = AdminChunksRequest['items'][number]

const chunkKey = (chunk: { articleKey: string; idx: number }) => `${chunk.articleKey}#${chunk.idx}`

const chunkFields = (item: ChunkItem) => ({
  sourceId: item.sourceId,
  text: item.text,
  topic: item.topic,
  type: item.type,
  periodFrom: item.periodFrom,
  periodTo: item.periodTo,
  wikidataId: item.wikidataId ?? null,
})

type ChunkFields = ReturnType<typeof chunkFields>

const sameChunk = (stored: ChunkFields, wanted: ChunkFields) =>
  (Object.keys(wanted) as (keyof ChunkFields)[]).every((field) => stored[field] === wanted[field])

const isUnknownSource = (error: unknown) => findPgViolation(error)?.code === '23503'

export const syncChunks = async (
  db: Database,
  request: AdminChunksRequest,
): Promise<AdminChunksResponse> => {
  try {
    return await db.transaction(async (tx) => {
      const stored = await tx
        .select({
          id: chunks.id,
          articleKey: chunks.articleKey,
          idx: chunks.idx,
          sourceId: chunks.sourceId,
          text: chunks.text,
          topic: chunks.topic,
          type: chunks.type,
          periodFrom: chunks.periodFrom,
          periodTo: chunks.periodTo,
          wikidataId: chunks.wikidataId,
        })
        .from(chunks)
      const storedByKey = new Map(stored.map((row) => [chunkKey(row), row]))
      const wantedKeys = new Set(request.items.map(chunkKey))

      const added = request.items.filter((item) => !storedByKey.has(chunkKey(item)))
      const changed = request.items.flatMap((item) => {
        const row = storedByKey.get(chunkKey(item))
        const fields = chunkFields(item)
        return row && !sameChunk(row, fields) ? [{ id: row.id, fields }] : []
      })
      const stale = stored.filter((row) => !wantedKeys.has(chunkKey(row))).map((row) => row.id)

      if (stale.length > 0) await tx.delete(chunks).where(inArray(chunks.id, stale))
      for (const { id, fields } of changed) {
        await tx.update(chunks).set(fields).where(eq(chunks.id, id))
      }
      if (added.length > 0) {
        await tx.insert(chunks).values(
          added.map((item) => ({
            articleKey: item.articleKey,
            idx: item.idx,
            ...chunkFields(item),
          })),
        )
      }
      return {
        inserted: added.length,
        updated: changed.length,
        unchanged: request.items.length - added.length - changed.length,
        deleted: stale.length,
      }
    })
  } catch (error) {
    if (isUnknownSource(error)) throw new ApiError(400, 'bad_request', 'Невідоме джерело чанка')
    throw error
  }
}

const synonymKey = (synonym: { term: string; variant: string }) =>
  `${synonym.term}\u0000${synonym.variant}`

export const upsertSynonyms = async (
  db: Database,
  request: AdminSynonymsRequest,
): Promise<AdminSynonymsResponse> =>
  db.transaction(async (tx) => {
    const items = lastByKey(request.items, synonymKey)
    const stored = await tx
      .select()
      .from(synonyms)
      .where(
        inArray(
          synonyms.term,
          items.map((item) => item.term),
        ),
      )
    const storedByKey = new Map(stored.map((row) => [synonymKey(row), row]))

    const added = items.filter((item) => !storedByKey.has(synonymKey(item)))
    const changed = items.flatMap((item) => {
      const row = storedByKey.get(synonymKey(item))
      return row && row.type !== item.type ? [{ id: row.id, type: item.type }] : []
    })

    for (const { id, type } of changed) {
      await tx.update(synonyms).set({ type }).where(eq(synonyms.id, id))
    }
    if (added.length > 0) await tx.insert(synonyms).values(added)
    return {
      inserted: added.length,
      updated: changed.length,
      unchanged: items.length - added.length - changed.length,
    }
  })

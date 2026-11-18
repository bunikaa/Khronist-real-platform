import type { RecentQuery, RecentResponse } from '@khronist/contracts'
import { and, asc, desc, eq, gt, lt, lte, notExists, or, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { documents, pages, regions, transcriptions } from '../db/schema.ts'
import { cursorCodec } from '../lib/cursor.ts'
import { shelfmarkOf } from './transcriptions.ts'

const exactTimePattern = /^[1-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

const isRealTime = (at: string) => {
  const time = new Date(at)
  return !Number.isNaN(time.getTime()) && time.toISOString().slice(0, 23) === at.slice(0, 23)
}

const recentCursorSchema = z.object({
  at: z.string().regex(exactTimePattern).refine(isRealTime),
  id: z.uuid(),
})
type RecentCursor = z.infer<typeof recentCursorSchema>

export const { encode: encodeRecentCursor, decode: decodeRecentCursor } = cursorCodec(
  recentCursorSchema,
  'Некоректний курсор стрічки',
)

const snippetLength = 200
const snippetSource = snippetLength * 5

const newerVerified = alias(transcriptions, 'newer_verified')

const exactVerifiedAt = sql<string>`to_char(${transcriptions.verifiedAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`

const afterCursor = (cursor: RecentCursor | undefined) => {
  if (!cursor) return undefined
  const at = sql`${cursor.at}::timestamptz`
  return and(
    lte(transcriptions.verifiedAt, at),
    or(lt(transcriptions.verifiedAt, at), gt(transcriptions.id, cursor.id)),
  )
}

const recentVerified = (db: Database, cursor: RecentCursor | undefined, count: number) =>
  db
    .select({
      transcriptionId: transcriptions.id,
      text: sql<string>`left(${transcriptions.normalizedText}, ${snippetSource})`,
      verifiedAt: transcriptions.verifiedAt,
      exactVerifiedAt,
      archive: documents.archive,
      fond: documents.fond,
      opys: documents.opys,
      sprava: documents.sprava,
      portal: documents.portal,
      yearFrom: documents.yearFrom,
      yearTo: documents.yearTo,
      folio: pages.folio,
      imageNo: pages.imageNo,
      sourceUrl: pages.sourceUrl,
    })
    .from(transcriptions)
    .innerJoin(regions, eq(regions.id, transcriptions.regionId))
    .innerJoin(pages, eq(pages.id, regions.pageId))
    .innerJoin(documents, eq(documents.id, pages.documentId))
    .where(
      and(
        sql`${transcriptions.status} = 'verified'`,
        notExists(
          db
            .select({ id: newerVerified.id })
            .from(newerVerified)
            .where(
              and(
                eq(newerVerified.regionId, transcriptions.regionId),
                eq(newerVerified.status, 'verified'),
                gt(newerVerified.version, transcriptions.version),
              ),
            ),
        ),
        afterCursor(cursor),
      ),
    )
    .orderBy(desc(transcriptions.verifiedAt), asc(transcriptions.id))
    .limit(count)

type Row = Awaited<ReturnType<typeof recentVerified>>[number]

const snippetOf = (text: string) =>
  [...text.replace(/\s+/gu, ' ').trim()].slice(0, snippetLength).join('').trimEnd()

const itemOf = (row: Row): RecentResponse['items'][number] => {
  if (!row.verifiedAt) throw new Error(`verified transcription ${row.transcriptionId} has no time`)
  return {
    transcriptionId: row.transcriptionId,
    shelfmark: shelfmarkOf(row, row),
    ...(row.yearFrom !== null && { yearFrom: row.yearFrom }),
    ...(row.yearTo !== null && { yearTo: row.yearTo }),
    snippet: snippetOf(row.text),
    status: 'verified',
    ...(row.sourceUrl !== null && { portalUrl: row.sourceUrl }),
    verifiedAt: row.verifiedAt.toISOString(),
  }
}

export const recentRecords = async (db: Database, query: RecentQuery): Promise<RecentResponse> => {
  const cursor = query.cursor ? decodeRecentCursor(query.cursor) : undefined
  const rows = await recentVerified(db, cursor, query.limit + 1)
  const page = rows.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: page.map(itemOf),
    ...(rows.length > query.limit &&
      last && {
        nextCursor: encodeRecentCursor({ at: last.exactVerifiedAt, id: last.transcriptionId }),
      }),
  }
}

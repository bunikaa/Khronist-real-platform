import type { SearchQuery, SearchResponse } from '@khronist/contracts'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  lt,
  lte,
  notExists,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import { alias, union } from 'drizzle-orm/pg-core'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { documents, entities, pages, regions, transcriptions } from '../db/schema.ts'
import { ApiError } from '../lib/errors.ts'
import {
  anyConceptQuery,
  conceptRank,
  expandQuery,
  similarWordsOf,
  type Concept,
} from './retrieval.ts'
import { shelfmarkOf } from './transcriptions.ts'

const cursorSchema = z.object({ rank: z.number(), id: z.uuid() })
type Cursor = z.infer<typeof cursorSchema>

export const encodeCursor = (cursor: Cursor): string =>
  Buffer.from(JSON.stringify(cursor)).toString('base64url')

export const decodeCursor = (value: string): Cursor => {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
  } catch {
    throw new ApiError(400, 'bad_request', 'Некоректний курсор пошуку')
  }
}

const plainSnippet = 'StartSel="", StopSel=""'
const better = alias(transcriptions, 'better')

const nameMatch = (word: string) => sql`${word} <% ${entities.normalized}`

const matchedIds = (db: Database, concepts: Concept[], words: string[]) => {
  const byText = db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(sql`${transcriptions.tsv} @@ ${anyConceptQuery(concepts)}`)
  if (words.length === 0) return byText
  const byName = db
    .select({ id: entities.transcriptionId })
    .from(entities)
    .where(or(...words.map(nameMatch)))
  return union(byText, byName)
}

const nameSimilarity = (words: string[]) => {
  if (words.length === 0) return sql`0`
  const similarity = sql.join(
    words.map((word) => sql`word_similarity(${word}, ${entities.normalized})`),
    sql`, `,
  )
  return sql`coalesce((select max(greatest(${similarity})) from ${entities} where ${entities.transcriptionId} = ${transcriptions.id} and (${or(...words.map(nameMatch))})), 0)`
}

const betterVersion = (db: Database) =>
  db
    .select({ id: better.id })
    .from(better)
    .where(
      and(
        eq(better.regionId, transcriptions.regionId),
        sql`(${better.status} = 'verified', ${better.version}) > (${transcriptions.status} = 'verified', ${transcriptions.version})`,
      ),
    )

const filtersOf = (query: SearchQuery): SQL[] => {
  const archive = query.archive?.trim()
  const fond = query.fond?.trim()
  return [
    ...(query.verifiedOnly ? [eq(transcriptions.status, 'verified')] : []),
    ...(archive ? [eq(documents.archive, archive)] : []),
    ...(fond ? [eq(documents.fond, fond)] : []),
    ...(query.yearFrom === undefined ? [] : [gte(documents.yearTo, query.yearFrom)]),
    ...(query.yearTo === undefined ? [] : [lte(documents.yearFrom, query.yearTo)]),
  ]
}

const rankedHits = (db: Database, concepts: Concept[], words: string[], query: SearchQuery) => {
  const ranks = [
    ...concepts.map(({ terms }) => conceptRank(transcriptions.tsv, terms)),
    nameSimilarity(words),
  ]
  return db
    .select({
      transcriptionId: transcriptions.id,
      status: transcriptions.status,
      text: transcriptions.normalizedText,
      rank: sql<number>`(${sql.join(ranks, sql` + `)})::float8`.as('rank'),
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
        inArray(transcriptions.id, matchedIds(db, concepts, words)),
        notExists(betterVersion(db)),
        ...filtersOf(query),
      ),
    )
    .as('ranked')
}

const isEmptyYearRange = ({ yearFrom, yearTo }: SearchQuery) =>
  yearFrom !== undefined && yearTo !== undefined && yearFrom > yearTo

type Ranked = ReturnType<typeof rankedHits>

const hitsAfter = (
  db: Database,
  ranked: Ranked,
  concepts: Concept[],
  cursor: Cursor | undefined,
  count: number,
) =>
  db
    .select({
      transcriptionId: ranked.transcriptionId,
      status: ranked.status,
      rank: ranked.rank,
      archive: ranked.archive,
      fond: ranked.fond,
      opys: ranked.opys,
      sprava: ranked.sprava,
      portal: ranked.portal,
      yearFrom: ranked.yearFrom,
      yearTo: ranked.yearTo,
      folio: ranked.folio,
      imageNo: ranked.imageNo,
      sourceUrl: ranked.sourceUrl,
      snippet: sql<string>`ts_headline('simple', ${ranked.text}, ${anyConceptQuery(concepts)}, ${plainSnippet})`,
    })
    .from(ranked)
    .where(
      cursor &&
        or(
          lt(ranked.rank, cursor.rank),
          and(eq(ranked.rank, cursor.rank), gt(ranked.transcriptionId, cursor.id)),
        ),
    )
    .orderBy(desc(ranked.rank), asc(ranked.transcriptionId))
    .limit(count)

type Hit = Awaited<ReturnType<typeof hitsAfter>>[number]

const itemOf = (hit: Hit): SearchResponse['items'][number] => ({
  transcriptionId: hit.transcriptionId,
  shelfmark: shelfmarkOf(hit, hit),
  ...(hit.yearFrom !== null && { yearFrom: hit.yearFrom }),
  ...(hit.yearTo !== null && { yearTo: hit.yearTo }),
  snippet: hit.snippet.replace(/\s+/gu, ' ').trim(),
  status: hit.status,
  ...(hit.sourceUrl !== null && { portalUrl: hit.sourceUrl }),
})

export const searchCommons = async (db: Database, query: SearchQuery): Promise<SearchResponse> => {
  const cursor = query.cursor ? decodeCursor(query.cursor) : undefined
  if (isEmptyYearRange(query)) return { items: [] }
  const { words, concepts } = await expandQuery(db, query.q)
  if (concepts.length === 0) return { items: [] }

  const ranked = rankedHits(db, concepts, similarWordsOf(words), query)
  const hits = await hitsAfter(db, ranked, concepts, cursor, query.limit + 1)
  const page = hits.slice(0, query.limit)
  const last = page.at(-1)
  return {
    items: page.map(itemOf),
    ...(hits.length > query.limit &&
      last && { nextCursor: encodeCursor({ rank: last.rank, id: last.transcriptionId }) }),
  }
}

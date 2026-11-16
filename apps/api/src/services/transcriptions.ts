import type {
  Entity,
  Line,
  NormalizeOutput,
  ReadingWarning,
  Shelfmark,
  Transcription,
  Word,
} from '@khronist/contracts'
import { readingWarningSchema } from '@khronist/contracts'
import { asc, eq, inArray, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import {
  documents,
  entities,
  lineWords,
  pages,
  regions,
  transcriptionLines,
  transcriptions,
  user,
} from '../db/schema.ts'

const extraSchema = z.record(z.string(), z.unknown())

const wordRowsPerInsert = 5000

export type NewVersion = {
  regionId: string
  reader: string
  lines: Line[]
  warnings: ReadingWarning[]
  normalized: NormalizeOutput | null
  entities: Entity[]
  authorId?: string
}

export const warningsOf = (stored: string[]): ReadingWarning[] =>
  stored.flatMap((warning) => {
    const parsed = readingWarningSchema.safeParse(warning)
    return parsed.success ? [parsed.data] : []
  })

export const shelfmarkOf = (
  document: typeof documents.$inferSelect,
  page: typeof pages.$inferSelect,
): Shelfmark => ({
  archive: document.archive,
  fond: document.fond,
  opys: document.opys,
  sprava: document.sprava,
  ...(page.folio !== null && { folio: page.folio }),
  ...(page.imageNo !== null && { image: page.imageNo }),
  ...(document.portal !== null && { portal: document.portal }),
  ...(page.sourceUrl !== null && { portalUrl: page.sourceUrl }),
})

export const normalizedTextOf = (lines: Line[], normalized: NormalizeOutput | null): string =>
  (normalized?.lines ?? lines).map((line) => line.text).join('\n')

export const insertEntities = async (
  tx: Database,
  transcriptionId: string,
  found: Entity[],
): Promise<void> => {
  if (found.length === 0) return
  await tx.insert(entities).values(
    found.map((entity) => ({
      transcriptionId,
      type: entity.type,
      text: entity.text,
      normalized: entity.normalized ?? null,
      wikidataId: entity.wikidataId ?? null,
      startPos: entity.start,
      endPos: entity.end,
      extra: entity.extra ?? null,
    })),
  )
}

export const insertTranscriptionVersion = async (
  tx: Database,
  version: NewVersion,
): Promise<string> => {
  const { regionId, reader, lines, warnings, normalized, entities: found } = version
  const [latest] = await tx
    .select({ version: sql<number>`coalesce(max(${transcriptions.version}), 0)` })
    .from(transcriptions)
    .where(eq(transcriptions.regionId, regionId))

  const [transcription] = await tx
    .insert(transcriptions)
    .values({
      regionId,
      version: (latest?.version ?? 0) + 1,
      rawText: lines.map((line) => line.text).join('\n'),
      normalizedText: normalizedTextOf(lines, normalized),
      normalizedLines: normalized?.lines ?? null,
      expansions: normalized?.expansions ?? null,
      warnings,
      reader,
      authorId: version.authorId ?? null,
    })
    .returning({ id: transcriptions.id })
  if (!transcription) throw new Error('transcription was not inserted')

  const entries = lines.map((line) => ({ line, id: uuidv7() }))
  await tx.insert(transcriptionLines).values(
    entries.map(({ line, id }) => ({
      id,
      transcriptionId: transcription.id,
      idx: line.idx,
      text: line.text,
      x: line.box.x,
      y: line.box.y,
      w: line.box.w,
      h: line.box.h,
      boxSource: line.boxSource,
    })),
  )

  const wordRows = entries.flatMap(({ line, id }) =>
    line.words.map((word, wordIndex) => ({
      lineId: id,
      idx: wordIndex,
      text: word.text,
      uncertain: word.uncertain,
      confidence: word.confidence ?? null,
    })),
  )
  for (let start = 0; start < wordRows.length; start += wordRowsPerInsert) {
    await tx.insert(lineWords).values(wordRows.slice(start, start + wordRowsPerInsert))
  }

  await insertEntities(tx, transcription.id, found)
  return transcription.id
}

export const loadLines = async (db: Database, transcriptionId: string): Promise<Line[]> => {
  const lineRows = await db
    .select()
    .from(transcriptionLines)
    .where(eq(transcriptionLines.transcriptionId, transcriptionId))
    .orderBy(asc(transcriptionLines.idx))
  const wordRows =
    lineRows.length === 0
      ? []
      : await db
          .select()
          .from(lineWords)
          .where(
            inArray(
              lineWords.lineId,
              lineRows.map((line) => line.id),
            ),
          )
          .orderBy(asc(lineWords.idx))
  const wordsByLine = new Map<string, Word[]>()
  for (const word of wordRows) {
    const words = wordsByLine.get(word.lineId) ?? []
    words.push({
      text: word.text,
      uncertain: word.uncertain,
      ...(word.confidence !== null && { confidence: word.confidence }),
    })
    wordsByLine.set(word.lineId, words)
  }
  return lineRows.map((line) => {
    const words = wordsByLine.get(line.id) ?? []
    return {
      idx: line.idx,
      text: line.text,
      box: { x: line.x, y: line.y, w: line.w, h: line.h },
      boxSource: line.boxSource,
      uncertain: words.some((word) => word.uncertain),
      words,
    }
  })
}

const readTranscription = async (
  db: Database,
  transcriptionId: string,
): Promise<Transcription | undefined> => {
  const [t] = await db
    .select()
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId))
    .limit(1)
  if (!t) return undefined

  const [region] = await db.select().from(regions).where(eq(regions.id, t.regionId)).limit(1)
  if (!region) return undefined

  const lines = await loadLines(db, t.id)
  const entityRows = await db.select().from(entities).where(eq(entities.transcriptionId, t.id))

  let shelfmark: Shelfmark | undefined
  if (region.pageId) {
    const [row] = await db
      .select({ page: pages, document: documents })
      .from(pages)
      .innerJoin(documents, eq(pages.documentId, documents.id))
      .where(eq(pages.id, region.pageId))
      .limit(1)
    if (row) shelfmark = shelfmarkOf(row.document, row.page)
  }

  const nameOf = async (userId: string | null) => {
    if (!userId) return undefined
    const [row] = await db
      .select({ name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1)
    return row ? { name: row.name } : undefined
  }
  const author = await nameOf(t.authorId)
  const verifiedBy = await nameOf(t.verifiedBy)

  return {
    id: t.id,
    regionId: t.regionId,
    ...(shelfmark && { shelfmark }),
    box: { x: region.x, y: region.y, w: region.w, h: region.h },
    version: t.version,
    status: t.status,
    lines,
    normalizedText: t.normalizedText,
    ...(t.normalizedLines && { normalizedLines: t.normalizedLines }),
    ...(t.expansions && { expansions: t.expansions }),
    entities: entityRows.map((entity) => {
      const extra = extraSchema.safeParse(entity.extra)
      return {
        type: entity.type,
        text: entity.text,
        start: entity.startPos,
        end: entity.endPos,
        ...(entity.normalized !== null && { normalized: entity.normalized }),
        ...(entity.wikidataId !== null && { wikidataId: entity.wikidataId }),
        ...(extra.success && { extra: extra.data }),
      }
    }),
    ...(t.warnings.length > 0 && { warnings: warningsOf(t.warnings) }),
    reader: t.reader,
    ...(author && { author }),
    ...(verifiedBy && { verifiedBy }),
    ...(t.verifiedSignature !== null && { verifiedSignature: t.verifiedSignature }),
    ...(t.verifiedAt && { verifiedAt: t.verifiedAt.toISOString() }),
    createdAt: t.createdAt.toISOString(),
  }
}

export const loadTranscription = (
  db: Database,
  transcriptionId: string,
): Promise<Transcription | undefined> =>
  db.transaction((snapshot) => readTranscription(snapshot, transcriptionId), {
    isolationLevel: 'repeatable read',
    accessMode: 'read only',
  })

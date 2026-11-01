import type { Line, Shelfmark, Transcription } from '@khronist/contracts'
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
import type { Normalized } from './normalize.ts'

const extraSchema = z.record(z.string(), z.unknown())

type NewVersion = {
  regionId: string
  reader: string
  lines: Line[]
  normalized: Normalized
}

export const insertTranscriptionVersion = async (
  tx: Database,
  version: NewVersion,
): Promise<string> => {
  const { regionId, reader, lines, normalized } = version
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
      normalizedText: normalized.normalizedText,
      reader,
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
  if (wordRows.length > 0) await tx.insert(lineWords).values(wordRows)

  if (normalized.entities.length > 0) {
    await tx.insert(entities).values(
      normalized.entities.map((entity) => ({
        transcriptionId: transcription.id,
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
  return transcription.id
}

export const loadTranscription = async (
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

  const lineRows = await db
    .select()
    .from(transcriptionLines)
    .where(eq(transcriptionLines.transcriptionId, t.id))
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
  const entityRows = await db.select().from(entities).where(eq(entities.transcriptionId, t.id))

  let shelfmark: Shelfmark | undefined
  if (region.pageId) {
    const [row] = await db
      .select({ page: pages, document: documents })
      .from(pages)
      .innerJoin(documents, eq(pages.documentId, documents.id))
      .where(eq(pages.id, region.pageId))
      .limit(1)
    if (row) {
      shelfmark = {
        archive: row.document.archive,
        fond: row.document.fond,
        opys: row.document.opys,
        sprava: row.document.sprava,
        ...(row.page.folio !== null && { folio: row.page.folio }),
        ...(row.page.imageNo !== null && { image: row.page.imageNo }),
        ...(row.document.portal !== null && { portal: row.document.portal }),
        ...(row.page.sourceUrl !== null && { portalUrl: row.page.sourceUrl }),
      }
    }
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
    lines: lineRows.map((line) => {
      const words = wordRows
        .filter((word) => word.lineId === line.id)
        .map((word) => ({
          text: word.text,
          uncertain: word.uncertain,
          ...(word.confidence !== null && { confidence: word.confidence }),
        }))
      return {
        idx: line.idx,
        text: line.text,
        box: { x: line.x, y: line.y, w: line.w, h: line.h },
        boxSource: line.boxSource,
        uncertain: words.some((word) => word.uncertain),
        words,
      }
    }),
    normalizedText: t.normalizedText,
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
    reader: t.reader,
    ...(author && { author }),
    ...(verifiedBy && { verifiedBy }),
    ...(t.verifiedAt && { verifiedAt: t.verifiedAt.toISOString() }),
    createdAt: t.createdAt.toISOString(),
  }
}

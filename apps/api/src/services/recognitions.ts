import {
  recognitionFailureCodeSchema,
  type Box,
  type CreateRecognitionRequest,
  type CreateRecognitionResponse,
  type RecognitionState,
  type Shelfmark,
  type Transcription,
} from '@khronist/contracts'
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import {
  documents,
  entities,
  lineWords,
  pages,
  recognitions,
  regions,
  transcriptionLines,
  transcriptions,
  user,
} from '../db/schema.ts'
import {
  activeStatuses,
  failStaleRecognitions,
  failureMessages,
  runRecognition,
  type JobLogger,
} from '../jobs/recognize.ts'
import type { EventHub } from '../jobs/events.ts'
import type { JobQueue } from '../jobs/queue.ts'
import { ApiError, isUniqueViolation } from '../lib/errors.ts'
import { decodePng } from '../lib/image.ts'
import type { HtrReader } from './htr/index.ts'
import type { Normalizer } from './normalize.ts'

export type RecognitionDeps = {
  db: Database
  reader: HtrReader | undefined
  normalizer: Normalizer
  hub: EventHub
  queue: JobQueue
  log: JobLogger
  readTimeoutMs?: number
  normalizeTimeoutMs?: number
  heartbeatMs?: number
  maxBacklog?: number
  staleAfterMs?: number
  maxStreamMs?: number
}

const wholePage: Box = { x: 0, y: 0, w: 1, h: 1 }

const isTrustedPortalHost = (hostname: string): boolean =>
  hostname === 'searcharchives.net.ua' || hostname.endsWith('.gov.ua')

const assertTrustedPortal = (shelfmark: Shelfmark) => {
  if (shelfmark.portalUrl === undefined) return
  if (!isTrustedPortalHost(new URL(shelfmark.portalUrl).hostname)) {
    throw new ApiError(400, 'bad_request', 'Недопустиме посилання на портал')
  }
}

const findOrCreatePage = async (db: Database, shelfmark: Shelfmark): Promise<string> => {
  await db
    .insert(documents)
    .values({
      archive: shelfmark.archive,
      fond: shelfmark.fond,
      opys: shelfmark.opys,
      sprava: shelfmark.sprava,
      portal: shelfmark.portal ?? null,
    })
    .onConflictDoNothing()
  const [document] = await db
    .select({ id: documents.id })
    .from(documents)
    .where(
      and(
        eq(documents.archive, shelfmark.archive),
        eq(documents.fond, shelfmark.fond),
        eq(documents.opys, shelfmark.opys),
        eq(documents.sprava, shelfmark.sprava),
      ),
    )
    .limit(1)
  if (!document) throw new Error('document was not created')

  const identity =
    shelfmark.image !== undefined
      ? eq(pages.imageNo, shelfmark.image)
      : shelfmark.folio !== undefined
        ? eq(pages.folio, shelfmark.folio)
        : undefined
  if (!identity) throw new ApiError(400, 'bad_request', 'Потрібен номер аркуша або зображення')
  const match = and(eq(pages.documentId, document.id), identity)
  const lookup = () => db.select({ id: pages.id }).from(pages).where(match).limit(1)

  const [existing] = await lookup()
  if (existing) return existing.id

  let folio = shelfmark.folio ?? null
  if (folio !== null && shelfmark.image !== undefined) {
    const [taken] = await db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.documentId, document.id), eq(pages.folio, folio)))
      .limit(1)
    if (taken) folio = null
  }
  await db
    .insert(pages)
    .values({
      documentId: document.id,
      folio,
      imageNo: shelfmark.image ?? null,
      sourceUrl: shelfmark.portalUrl ?? null,
    })
    .onConflictDoNothing()
  const [created] = await lookup()
  if (!created) throw new Error('page was not created')
  return created.id
}

const findOrCreateRegion = async (
  db: Database,
  imageHash: string,
  box: Box,
  pageId: string | null,
) => {
  await db
    .insert(regions)
    .values({ pageId, x: box.x, y: box.y, w: box.w, h: box.h, imageHash })
    .onConflictDoNothing({ target: regions.imageHash })
  if (pageId !== null) {
    await db
      .update(regions)
      .set({ pageId })
      .where(and(eq(regions.imageHash, imageHash), isNull(regions.pageId)))
  }
  const [region] = await db.select().from(regions).where(eq(regions.imageHash, imageHash)).limit(1)
  if (!region) throw new Error('region was not created')
  return region
}

const findActiveRecognition = async (db: Database, regionId: string) => {
  const [active] = await db
    .select({ id: recognitions.id })
    .from(recognitions)
    .where(and(eq(recognitions.regionId, regionId), inArray(recognitions.status, [...activeStatuses])))
    .limit(1)
  return active
}

const findLatestTranscription = async (db: Database, regionId: string) => {
  const [latest] = await db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(eq(transcriptions.regionId, regionId))
    .orderBy(desc(transcriptions.version))
    .limit(1)
  return latest
}

const answerFromCache = async (
  db: Database,
  regionId: string,
  source: CreateRecognitionRequest['source'],
  transcriptionId: string,
): Promise<CreateRecognitionResponse> => {
  const [done] = await db
    .insert(recognitions)
    .values({ regionId, source, status: 'done', transcriptionId, finishedAt: new Date() })
    .returning({ id: recognitions.id })
  if (!done) throw new Error('recognition was not recorded')
  return { recognitionId: done.id, status: 'cached', transcriptionId }
}

export const createRecognition = async (
  deps: RecognitionDeps,
  request: CreateRecognitionRequest,
): Promise<CreateRecognitionResponse> => {
  const { db, queue } = deps
  const image = decodePng(request.image.base64Png)
  if (image.sha256 !== request.imageHash) {
    throw new ApiError(400, 'bad_image', 'Хеш не збігається із зображенням')
  }
  if (request.shelfmark) assertTrustedPortal(request.shelfmark)

  const pageId = request.shelfmark ? await findOrCreatePage(db, request.shelfmark) : null
  const region = await findOrCreateRegion(db, image.sha256, request.box ?? wholePage, pageId)

  const cached = await findLatestTranscription(db, region.id)
  if (cached) return answerFromCache(db, region.id, request.source, cached.id)

  const reader = deps.reader
  if (!reader) throw new ApiError(503, 'reader_unavailable', 'Читання тимчасово недоступне')

  await failStaleRecognitions(db, region.id, deps.staleAfterMs ?? 10 * 60_000)
  const running = await findActiveRecognition(db, region.id)
  if (running) return { recognitionId: running.id, status: 'queued' }

  if (!queue.reserve(deps.maxBacklog ?? 50)) {
    throw new ApiError(429, 'too_many_requests', 'Забагато запитів у черзі, спробуйте за хвилину')
  }

  let recognitionId: string
  try {
    const [inserted] = await db
      .insert(recognitions)
      .values({ regionId: region.id, source: request.source })
      .returning({ id: recognitions.id })
    if (!inserted) throw new Error('recognition was not recorded')
    recognitionId = inserted.id
  } catch (error) {
    queue.release()
    if (!isUniqueViolation(error)) throw error
    const winner = await findActiveRecognition(db, region.id)
    if (winner) return { recognitionId: winner.id, status: 'queued' }
    const finished = await findLatestTranscription(db, region.id)
    if (finished) return answerFromCache(db, region.id, request.source, finished.id)
    throw error
  }

  const finishedMeanwhile = await findLatestTranscription(db, region.id)
  if (finishedMeanwhile) {
    queue.release()
    await db
      .update(recognitions)
      .set({ status: 'done', transcriptionId: finishedMeanwhile.id, finishedAt: new Date() })
      .where(and(eq(recognitions.id, recognitionId), eq(recognitions.status, 'queued')))
    return { recognitionId, status: 'cached', transcriptionId: finishedMeanwhile.id }
  }

  const job = { recognitionId, image: image.bytes, hints: request.hints }
  queue.add(() =>
    runRecognition(
      {
        db,
        reader,
        normalizer: deps.normalizer,
        hub: deps.hub,
        log: deps.log,
        ...(deps.readTimeoutMs !== undefined && { readTimeoutMs: deps.readTimeoutMs }),
        ...(deps.normalizeTimeoutMs !== undefined && { normalizeTimeoutMs: deps.normalizeTimeoutMs }),
      },
      job,
    ),
  )
  return { recognitionId, status: 'queued' }
}

export const loadTranscription = async (
  db: Database,
  transcriptionId: string,
): Promise<Transcription | undefined> => {
  const [t] = await db.select().from(transcriptions).where(eq(transcriptions.id, transcriptionId)).limit(1)
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
          .where(inArray(lineWords.lineId, lineRows.map((line) => line.id)))
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
    const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1)
    return row ? { name: row.name } : undefined
  }
  const author = await nameOf(t.authorId)
  const verifiedBy = await nameOf(t.verifiedBy)

  const extraSchema = z.record(z.string(), z.unknown())

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

export const findRecognition = async (db: Database, id: string) => {
  const [row] = await db.select().from(recognitions).where(eq(recognitions.id, id)).limit(1)
  return row
}

export const getRecognitionState = async (
  db: Database,
  id: string,
): Promise<RecognitionState | undefined> => {
  const row = await findRecognition(db, id)
  if (!row) return undefined
  const transcription = row.transcriptionId ? await loadTranscription(db, row.transcriptionId) : undefined
  const parsedCode = recognitionFailureCodeSchema.safeParse(row.errorCode)
  const code = parsedCode.success ? parsedCode.data : 'read_failed'
  return {
    recognitionId: row.id,
    status: row.status,
    ...(transcription && { transcription }),
    ...(row.status === 'failed' && {
      error: { code, message: row.errorMessage ?? failureMessages[code] },
    }),
  }
}

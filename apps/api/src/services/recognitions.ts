import type {
  Box,
  CreateRecognitionRequest,
  CreateRecognitionResponse,
  RecognitionEvent,
  RecognitionState,
  Shelfmark,
} from '@khronist/contracts'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { Database } from '../db/client.ts'
import {
  activeRecognitionStatuses,
  documents,
  pages,
  recognitions,
  regions,
  transcriptions,
} from '../db/schema.ts'
import {
  failStaleRecognitions,
  failureEvent,
  failureOf,
  markFailed,
  runRecognition,
  type JobLogger,
} from '../jobs/recognize.ts'
import type { EventHub } from '../jobs/events.ts'
import type { JobQueue } from '../jobs/queue.ts'
import { ApiError, isUniqueViolation } from '../lib/errors.ts'
import { decodePng } from '../lib/image.ts'
import type { HtrReader } from './htr/index.ts'
import type { Normalizer } from './normalize.ts'
import { loadTranscription } from './transcriptions.ts'

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
    .where(and(eq(recognitions.regionId, regionId), inArray(recognitions.status, [...activeRecognitionStatuses])))
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

  try {
    const finishedMeanwhile = await findLatestTranscription(db, region.id)
    if (finishedMeanwhile) {
      await db
        .update(recognitions)
        .set({ status: 'done', transcriptionId: finishedMeanwhile.id, finishedAt: new Date() })
        .where(and(eq(recognitions.id, recognitionId), eq(recognitions.status, 'queued')))
      queue.release()
      return { recognitionId, status: 'cached', transcriptionId: finishedMeanwhile.id }
    }
  } catch (error) {
    queue.release()
    await markFailed(db, recognitionId, 'read_failed').catch((markError: unknown) =>
      deps.log.error({ err: markError, recognitionId }, 'could not record the failure'),
    )
    throw error
  }

  queue.add(() =>
    runRecognition({ ...deps, reader }, { recognitionId, image: image.bytes, hints: request.hints }),
  )
  return { recognitionId, status: 'queued' }
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
  return {
    recognitionId: row.id,
    status: row.status,
    ...(transcription && { transcription }),
    ...(row.status === 'failed' && { error: failureOf(row) }),
  }
}

type RecognitionRow = NonNullable<Awaited<ReturnType<typeof findRecognition>>>

export const replayEvents = async (db: Database, row: RecognitionRow): Promise<RecognitionEvent[]> => {
  if (row.status === 'failed') return [{ event: 'failed', data: failureOf(row) }]
  const transcription = row.transcriptionId ? await loadTranscription(db, row.transcriptionId) : undefined
  if (!transcription) return [failureEvent('save_failed')]
  return [
    ...transcription.lines.map((line): RecognitionEvent => ({ event: 'line', data: { line } })),
    { event: 'done', data: { transcriptionId: transcription.id } },
  ]
}

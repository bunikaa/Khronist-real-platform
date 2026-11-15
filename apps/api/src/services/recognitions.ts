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
import type { EventHub } from '../jobs/events.ts'
import type { JobQueue } from '../jobs/queue.ts'
import {
  failStaleRecognitions,
  failureEvent,
  failureOf,
  markFailed,
  runRecognition,
  type JobLogger,
} from '../jobs/recognize.ts'
import { ApiError, isUniqueViolation } from '../lib/errors.ts'
import { decodePng } from '../lib/image.ts'
import { activeRecognitionsPerClient, maxBacklog } from '../lib/limits.ts'
import type { HtrReader } from './htr/index.ts'
import type { CallBudget } from './llm/index.ts'
import type { EntityExtractor, Normalizer } from './normalize.ts'
import { loadTranscription } from './transcriptions.ts'

export type RecognitionDeps = {
  db: Database
  reader: HtrReader | undefined
  normalizer: Normalizer
  entities: EntityExtractor
  budget: CallBudget
  hub: EventHub
  queue: JobQueue
  log: JobLogger
  readTimeoutMs?: number | undefined
  normalizeTimeoutMs?: number | undefined
  entitiesTimeoutMs?: number | undefined
  heartbeatMs?: number | undefined
  maxBacklog?: number | undefined
  staleAfterMs?: number | undefined
  maxStreamMs?: number | undefined
}

export type DailyAllowance = { allowed: boolean; retryAfterSeconds: number }

export type RecognitionClient = {
  key: string
  trusted: boolean
  consumeDailyRead: () => Promise<DailyAllowance>
}

const wholePage: Box = { x: 0, y: 0, w: 1, h: 1 }

type PageMetadata = Pick<CreateRecognitionRequest, 'document'>

const findOrCreatePage = async (
  db: Database,
  shelfmark: Shelfmark,
  metadata: PageMetadata | undefined,
): Promise<string> => {
  await db
    .insert(documents)
    .values({
      archive: shelfmark.archive,
      fond: shelfmark.fond,
      opys: shelfmark.opys,
      sprava: shelfmark.sprava,
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
      ? { imageNo: shelfmark.image, folio: null, match: eq(pages.imageNo, shelfmark.image) }
      : shelfmark.folio !== undefined
        ? { imageNo: null, folio: shelfmark.folio, match: eq(pages.folio, shelfmark.folio) }
        : undefined
  if (!identity) throw new ApiError(400, 'bad_request', 'Потрібен номер аркуша або зображення')
  const lookup = () =>
    db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.documentId, document.id), identity.match))
      .limit(1)

  let [page] = await lookup()
  if (!page) {
    await db
      .insert(pages)
      .values({ documentId: document.id, folio: identity.folio, imageNo: identity.imageNo })
      .onConflictDoNothing()
    ;[page] = await lookup()
  }
  if (!page) throw new Error('page was not created')
  if (metadata) await saveMetadata(db, document.id, page.id, shelfmark, metadata)
  return page.id
}

const saveMetadata = async (
  db: Database,
  documentId: string,
  pageId: string,
  shelfmark: Shelfmark,
  metadata: PageMetadata,
) => {
  const documentFields = {
    ...(shelfmark.portal !== undefined && { portal: shelfmark.portal }),
    ...(metadata.document && {
      yearFrom: metadata.document.yearFrom,
      yearTo: metadata.document.yearTo,
    }),
  }
  if (Object.keys(documentFields).length > 0) {
    await db.update(documents).set(documentFields).where(eq(documents.id, documentId))
  }
  const pageFields = {
    ...(shelfmark.image !== undefined &&
      shelfmark.folio !== undefined && { folio: shelfmark.folio }),
    ...(shelfmark.portalUrl !== undefined && { sourceUrl: shelfmark.portalUrl }),
  }
  if (Object.keys(pageFields).length > 0) {
    await db.update(pages).set(pageFields).where(eq(pages.id, pageId))
  }
}

const findRegion = async (db: Database, imageHash: string) => {
  const [region] = await db.select().from(regions).where(eq(regions.imageHash, imageHash)).limit(1)
  return region
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
  const region = await findRegion(db, imageHash)
  if (!region) throw new Error('region was not created')
  return region
}

const findActiveRecognition = async (db: Database, regionId: string) => {
  const [active] = await db
    .select({ id: recognitions.id })
    .from(recognitions)
    .where(
      and(
        eq(recognitions.regionId, regionId),
        inArray(recognitions.status, [...activeRecognitionStatuses]),
      ),
    )
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

const unavailable = () => new ApiError(503, 'reader_unavailable', 'Читання тимчасово недоступне')

export const createRecognition = async (
  deps: RecognitionDeps,
  request: CreateRecognitionRequest,
  client: RecognitionClient,
): Promise<CreateRecognitionResponse> => {
  const { db, queue } = deps
  const image = decodePng(request.image.base64Png)
  if (image.sha256 !== request.imageHash) {
    throw new ApiError(400, 'bad_image', 'Хеш не збігається із зображенням')
  }

  const metadata = client.trusted ? { document: request.document } : undefined
  const known = await findRegion(db, image.sha256)
  const cached = known && (await findLatestTranscription(db, known.id))
  if (known && cached) {
    if (request.shelfmark && (known.pageId === null || metadata)) {
      const pageId = await findOrCreatePage(db, request.shelfmark, metadata)
      await db
        .update(regions)
        .set({ pageId })
        .where(and(eq(regions.id, known.id), isNull(regions.pageId)))
    }
    return answerFromCache(db, known.id, request.source, cached.id)
  }

  const reader = deps.reader
  if (!reader || !(await deps.budget.available())) throw unavailable()

  if (known) {
    await failStaleRecognitions(db, {
      regionId: known.id,
      code: 'read_failed',
      olderThanMs: deps.staleAfterMs,
    })
    const running = await findActiveRecognition(db, known.id)
    if (running) return { recognitionId: running.id, status: 'queued' }
  }

  const slot = queue.reserve(client.key, {
    total: deps.maxBacklog ?? maxBacklog,
    perOwner: activeRecognitionsPerClient,
  })
  if (slot === 'stopped') {
    throw new ApiError(
      503,
      'shutting_down',
      'Сервер перезапускається, спробуйте за кілька секунд',
      5,
    )
  }
  if (slot === 'full') {
    throw new ApiError(429, 'too_many_requests', 'Забагато запитів у черзі, спробуйте за хвилину')
  }
  if (slot === 'busy') {
    throw new ApiError(
      429,
      'too_many_requests',
      'Забагато одночасних розпізнавань, дочекайтеся результату',
    )
  }

  let started = false
  try {
    const daily = await client.consumeDailyRead()
    if (!daily.allowed) {
      throw new ApiError(
        429,
        'too_many_requests',
        'Денний ліміт розпізнавань вичерпано, спробуйте завтра',
        daily.retryAfterSeconds,
      )
    }

    const pageId = request.shelfmark
      ? await findOrCreatePage(db, request.shelfmark, metadata)
      : null
    const region = await findOrCreateRegion(db, image.sha256, request.box ?? wholePage, pageId)

    let recognitionId: string
    try {
      const [inserted] = await db
        .insert(recognitions)
        .values({ regionId: region.id, source: request.source })
        .returning({ id: recognitions.id })
      if (!inserted) throw new Error('recognition was not recorded')
      recognitionId = inserted.id
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const winner = await findActiveRecognition(db, region.id)
      if (winner) return { recognitionId: winner.id, status: 'queued' }
      const finished = await findLatestTranscription(db, region.id)
      if (finished) return answerFromCache(db, region.id, request.source, finished.id)
      throw error
    }

    const finishedMeanwhile = await findLatestTranscription(db, region.id).catch(
      async (error: unknown) => {
        await markFailed(db, recognitionId, 'read_failed').catch((markError: unknown) =>
          deps.log.error({ err: markError, recognitionId }, 'could not record the failure'),
        )
        throw error
      },
    )
    if (finishedMeanwhile) {
      await db
        .update(recognitions)
        .set({ status: 'done', transcriptionId: finishedMeanwhile.id, finishedAt: new Date() })
        .where(and(eq(recognitions.id, recognitionId), eq(recognitions.status, 'queued')))
      return { recognitionId, status: 'cached', transcriptionId: finishedMeanwhile.id }
    }

    slot.run(recognitionId, (signal) =>
      runRecognition(
        { ...deps, reader },
        { recognitionId, image: image.bytes, hints: request.hints, signal },
      ),
    )
    started = true
    return { recognitionId, status: 'queued' }
  } finally {
    if (!started) slot.release()
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
  const transcription = row.transcriptionId
    ? await loadTranscription(db, row.transcriptionId)
    : undefined
  return {
    recognitionId: row.id,
    status: row.status,
    ...(transcription && { transcription }),
    ...(row.status === 'failed' && { error: failureOf(row) }),
  }
}

type RecognitionRow = NonNullable<Awaited<ReturnType<typeof findRecognition>>>

export const replayEvents = async (
  db: Database,
  row: RecognitionRow,
): Promise<RecognitionEvent[]> => {
  if (row.status === 'failed') return [{ event: 'failed', data: failureOf(row) }]
  const transcription = row.transcriptionId
    ? await loadTranscription(db, row.transcriptionId)
    : undefined
  if (!transcription) return [failureEvent('save_failed')]
  return [
    ...transcription.lines.map((line): RecognitionEvent => ({ event: 'line', data: { line } })),
    { event: 'done', data: { transcriptionId: transcription.id } },
  ]
}

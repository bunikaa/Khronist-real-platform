import {
  lineSchema,
  recognitionFailureCodeSchema,
  type Entity,
  type Hints,
  type Line,
  type NormalizeOutput,
  type RecognitionEvent,
  type RecognitionFailureCode,
} from '@khronist/contracts'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { activeRecognitionStatuses, recognitions } from '../db/schema.ts'
import {
  entitiesTimeoutMs,
  normalizeTimeoutMs,
  readTimeoutMs,
  staleAfterMs,
} from '../lib/limits.ts'
import { runWithTimeout } from '../lib/timeout.ts'
import type { HtrReader } from '../services/htr/index.ts'
import { assertNormalized, type EntityExtractor, type Normalizer } from '../services/normalize.ts'
import { insertTranscriptionVersion, normalizedTextOf } from '../services/transcriptions.ts'
import type { EventHub } from './events.ts'

const failureMessages: Record<RecognitionFailureCode, string> = {
  read_failed: 'Не вдалося прочитати фрагмент',
  no_text: 'На фрагменті не знайдено тексту. Виділіть ділянку із записом',
  normalize_failed: 'Не вдалося обробити прочитаний текст',
  save_failed: 'Не вдалося зберегти результат',
  restarted: 'Сервер було перезапущено, спробуйте ще раз',
  bad_image: 'Не вдалося обробити зображення',
  too_large: 'Зображення завелике',
}

export const failureEvent = (code: RecognitionFailureCode): RecognitionEvent => ({
  event: 'failed',
  data: { code, message: failureMessages[code] },
})

type StoredFailure = { errorCode: string | null; errorMessage: string | null }

export const failureOf = (row: StoredFailure) => {
  const parsed = recognitionFailureCodeSchema.safeParse(row.errorCode)
  const code = parsed.success ? parsed.data : 'read_failed'
  return { code, message: row.errorMessage ?? failureMessages[code] }
}

type LogFn = (details: object, message: string) => void

export type JobLogger = {
  info: LogFn
  warn: LogFn
  error: LogFn
  child: (bindings: Record<string, string>) => JobLogger
}

export type JobDeps = {
  db: Database
  reader: HtrReader
  normalizer: Normalizer
  entities: EntityExtractor
  hub: EventHub
  log: JobLogger
  readTimeoutMs?: number | undefined
  normalizeTimeoutMs?: number | undefined
  entitiesTimeoutMs?: number | undefined
}

export type RecognitionJob = {
  recognitionId: string
  image: Buffer
  hints?: Hints | undefined
  signal?: AbortSignal | undefined
}

type Stage = 'read' | 'normalize' | 'save'

const failureCodeFor: Record<Stage, RecognitionFailureCode> = {
  read: 'read_failed',
  normalize: 'normalize_failed',
  save: 'save_failed',
}

class JobCancelledError extends Error {
  constructor() {
    super('the recognition was closed by someone else while the job was running')
    this.name = 'JobCancelledError'
  }
}

class NoTextError extends Error {
  constructor() {
    super('the reader found no text in the fragment')
    this.name = 'NoTextError'
  }
}

const isActive = (id: string) =>
  and(eq(recognitions.id, id), inArray(recognitions.status, [...activeRecognitionStatuses]))

const setStatus = async (db: Database, id: string, status: 'reading' | 'normalizing') => {
  const rows = await db
    .update(recognitions)
    .set(
      status === 'reading'
        ? { status, startedAt: new Date(), attempts: sql`${recognitions.attempts} + 1` }
        : { status },
    )
    .where(isActive(id))
    .returning({ id: recognitions.id })
  if (rows.length === 0) throw new JobCancelledError()
}

const failedValues = (code: RecognitionFailureCode) => ({
  status: 'failed' as const,
  errorCode: code,
  errorMessage: failureMessages[code],
  finishedAt: new Date(),
})

export const markFailed = async (
  db: Database,
  id: string,
  code: RecognitionFailureCode,
): Promise<boolean> => {
  const rows = await db
    .update(recognitions)
    .set(failedValues(code))
    .where(isActive(id))
    .returning({ id: recognitions.id })
  return rows.length > 0
}

export const failRecognitions = async (
  db: Database,
  ids: string[],
  code: RecognitionFailureCode,
): Promise<string[]> => {
  if (ids.length === 0) return []
  const rows = await db
    .update(recognitions)
    .set(failedValues(code))
    .where(
      and(
        inArray(recognitions.id, ids),
        inArray(recognitions.status, [...activeRecognitionStatuses]),
      ),
    )
    .returning({ id: recognitions.id })
  return rows.map((row) => row.id)
}

type StaleScope = { code: RecognitionFailureCode; regionId?: string; olderThanMs?: number }

export const failStaleRecognitions = async (db: Database, scope: StaleScope): Promise<number> => {
  const rows = await db
    .update(recognitions)
    .set(failedValues(scope.code))
    .where(
      and(
        scope.regionId === undefined ? undefined : eq(recognitions.regionId, scope.regionId),
        inArray(recognitions.status, [...activeRecognitionStatuses]),
        lt(recognitions.createdAt, new Date(Date.now() - (scope.olderThanMs ?? staleAfterMs))),
      ),
    )
    .returning({ id: recognitions.id })
  return rows.length
}

const readSchema = z.array(lineSchema)

const checkLines = (raw: Line[]): Line[] => {
  const lines = readSchema.parse(raw)
  if (lines.length === 0) throw new NoTextError()
  lines.forEach((line, index) => {
    if (line.idx !== index) throw new Error(`line ${index} has index ${line.idx}`)
  })
  return lines
}

const checkEntities = (text: string, found: Entity[]): Entity[] => {
  for (const entity of found) {
    if (entity.end <= entity.start || entity.end > text.length) {
      throw new Error(`entity "${entity.text}" has an invalid span ${entity.start}-${entity.end}`)
    }
  }
  return found
}

type ReadingToSave = {
  reader: string
  lines: Line[]
  warnings: Awaited<ReturnType<HtrReader['read']>>['warnings']
  normalized: NormalizeOutput | null
  entities: Entity[]
}

const saveTranscription = async (
  db: Database,
  recognitionId: string,
  reading: ReadingToSave,
): Promise<string> =>
  db.transaction(async (tx) => {
    const [recognition] = await tx
      .select({ regionId: recognitions.regionId })
      .from(recognitions)
      .where(eq(recognitions.id, recognitionId))
      .limit(1)
    if (!recognition) throw new Error(`recognition ${recognitionId} disappeared`)

    const transcriptionId = await insertTranscriptionVersion(tx, {
      regionId: recognition.regionId,
      ...reading,
    })

    const closed = await tx
      .update(recognitions)
      .set({
        status: 'done',
        transcriptionId,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      })
      .where(isActive(recognitionId))
      .returning({ id: recognitions.id })
    if (closed.length === 0) throw new JobCancelledError()
    return transcriptionId
  })

const storedFailureEvent = async (db: Database, id: string): Promise<RecognitionEvent> => {
  const [row] = await db
    .select({ errorCode: recognitions.errorCode, errorMessage: recognitions.errorMessage })
    .from(recognitions)
    .where(eq(recognitions.id, id))
    .limit(1)
  return { event: 'failed', data: failureOf(row ?? { errorCode: 'restarted', errorMessage: null }) }
}

export const runRecognition = async (deps: JobDeps, job: RecognitionJob): Promise<void> => {
  const { db, reader, normalizer, hub } = deps
  const { recognitionId, hints, signal: stopped } = job
  const log = deps.log.child({ recognitionId })
  let stage: Stage = 'read'
  let transcriptionId: string
  try {
    await setStatus(db, recognitionId, 'reading')
    hub.publish(recognitionId, { event: 'progress', data: { status: 'reading' } })

    const read = await runWithTimeout(
      (signal) => reader.read({ image: job.image, hints, signal, log }),
      deps.readTimeoutMs ?? readTimeoutMs,
      'reading',
      stopped,
    )
    const lines = checkLines(read.lines)
    for (const line of lines) hub.publish(recognitionId, { event: 'line', data: { line } })

    stage = 'normalize'
    await setStatus(db, recognitionId, 'normalizing')
    hub.publish(recognitionId, { event: 'progress', data: { status: 'normalizing' } })
    const normalized = await runWithTimeout(
      (signal) => normalizer.normalize({ lines, hints, signal, log }),
      deps.normalizeTimeoutMs ?? normalizeTimeoutMs,
      'normalization',
      stopped,
    )
      .then((output) => output && assertNormalized(lines, output))
      .catch((error: unknown) => {
        log.warn({ err: error }, 'normalization failed, keeping the lines as read')
        return null
      })
    const normalizedText = normalizedTextOf(lines, normalized)
    const entities = await runWithTimeout(
      (signal) => deps.entities.extract(normalizedText, hints, signal),
      deps.entitiesTimeoutMs ?? entitiesTimeoutMs,
      'entities',
      stopped,
    )
      .then((found) => checkEntities(normalizedText, found))
      .catch((error: unknown) => {
        log.warn({ err: error }, 'entities failed, saving the transcription without them')
        return []
      })

    stage = 'save'
    transcriptionId = await saveTranscription(db, recognitionId, {
      reader: read.reader,
      lines,
      warnings: read.warnings,
      normalized,
      entities,
    })
  } catch (error) {
    const code = error instanceof NoTextError ? 'no_text' : failureCodeFor[stage]
    const closedElsewhere =
      error instanceof JobCancelledError ||
      !(await markFailed(db, recognitionId, code).catch((markError: unknown) => {
        log.error({ err: markError }, 'could not record the failure')
        return true
      }))
    if (closedElsewhere) log.error({ err: error, stage }, 'recognition cancelled')
    else if (code === 'no_text') log.info({ stage }, 'recognition found no text')
    else log.error({ err: error, stage }, 'recognition failed')
    const event = closedElsewhere
      ? await storedFailureEvent(db, recognitionId).catch(() => failureEvent('restarted'))
      : failureEvent(code)
    hub.publish(recognitionId, event)
    return
  }
  log.info({ transcriptionId }, 'recognition done')
  hub.publish(recognitionId, { event: 'done', data: { transcriptionId } })
}

import {
  lineSchema,
  recognitionFailureCodeSchema,
  type Hints,
  type Line,
  type RecognitionEvent,
  type RecognitionFailureCode,
} from '@khronist/contracts'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { activeRecognitionStatuses, recognitions } from '../db/schema.ts'
import { runWithTimeout } from '../lib/timeout.ts'
import type { HtrReader } from '../services/htr/index.ts'
import type { Normalized, Normalizer } from '../services/normalize.ts'
import { insertTranscriptionVersion } from '../services/transcriptions.ts'
import type { EventHub } from './events.ts'

const failureMessages: Record<RecognitionFailureCode, string> = {
  read_failed: 'Не вдалося прочитати фрагмент',
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

export type JobLogger = {
  error: (details: unknown, message?: string) => void
}

export type JobDeps = {
  db: Database
  reader: HtrReader
  normalizer: Normalizer
  hub: EventHub
  log: JobLogger
  readTimeoutMs?: number
  normalizeTimeoutMs?: number
}

export type RecognitionJob = {
  recognitionId: string
  image: Buffer
  hints?: Hints | undefined
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

export const markFailed = async (
  db: Database,
  id: string,
  code: RecognitionFailureCode,
): Promise<boolean> => {
  const rows = await db
    .update(recognitions)
    .set({
      status: 'failed',
      errorCode: code,
      errorMessage: failureMessages[code],
      finishedAt: new Date(),
    })
    .where(isActive(id))
    .returning({ id: recognitions.id })
  return rows.length > 0
}

const readSchema = z.array(lineSchema)

const checkLines = (raw: Line[]): Line[] => {
  const lines = readSchema.parse(raw)
  if (lines.length === 0) throw new Error('the reader returned no lines')
  lines.forEach((line, index) => {
    if (line.idx !== index) throw new Error(`line ${index} has index ${line.idx}`)
  })
  return lines
}

const checkNormalized = (normalized: Normalized): Normalized => {
  for (const entity of normalized.entities) {
    const insideText = entity.end <= normalized.normalizedText.length
    if (entity.end <= entity.start || !insideText) {
      throw new Error(`entity "${entity.text}" has an invalid span ${entity.start}-${entity.end}`)
    }
  }
  return normalized
}

const saveTranscription = async (
  db: Database,
  recognitionId: string,
  reader: string,
  lines: Line[],
  normalized: Normalized,
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
      reader,
      lines,
      normalized,
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
  const { db, reader, normalizer, hub, log } = deps
  const { recognitionId } = job
  let stage: Stage = 'read'
  let transcriptionId: string
  try {
    await setStatus(db, recognitionId, 'reading')
    hub.publish(recognitionId, { event: 'progress', data: { status: 'reading' } })

    const read = await runWithTimeout(
      (signal) => reader.read({ image: job.image, hints: job.hints, signal }),
      deps.readTimeoutMs ?? 30_000,
      'reading',
    )
    const lines = checkLines(read.lines)
    for (const line of lines) hub.publish(recognitionId, { event: 'line', data: { line } })

    stage = 'normalize'
    await setStatus(db, recognitionId, 'normalizing')
    hub.publish(recognitionId, { event: 'progress', data: { status: 'normalizing' } })
    const normalized = checkNormalized(
      await runWithTimeout(
        (signal) => normalizer.normalize(lines, job.hints, signal),
        deps.normalizeTimeoutMs ?? 20_000,
        'normalization',
      ),
    )

    stage = 'save'
    transcriptionId = await saveTranscription(db, recognitionId, read.reader, lines, normalized)
  } catch (error) {
    const code = failureCodeFor[stage]
    const closedElsewhere =
      error instanceof JobCancelledError ||
      !(await markFailed(db, recognitionId, code).catch((markError: unknown) => {
        log.error({ err: markError, recognitionId }, 'could not record the failure')
        return true
      }))
    log.error(
      { err: error, recognitionId, stage },
      closedElsewhere ? 'recognition cancelled' : 'recognition failed',
    )
    const event = closedElsewhere
      ? await storedFailureEvent(db, recognitionId).catch(() => failureEvent('restarted'))
      : failureEvent(code)
    hub.publish(recognitionId, event)
    return
  }
  hub.publish(recognitionId, { event: 'done', data: { transcriptionId } })
}

export const recoverInterruptedRecognitions = async (db: Database): Promise<number> => {
  const rows = await db
    .update(recognitions)
    .set({
      status: 'failed',
      errorCode: 'restarted',
      errorMessage: failureMessages.restarted,
      finishedAt: new Date(),
    })
    .where(inArray(recognitions.status, [...activeRecognitionStatuses]))
    .returning({ id: recognitions.id })
  return rows.length
}

export const failStaleRecognitions = async (
  db: Database,
  regionId: string,
  staleAfterMs: number,
): Promise<number> => {
  const rows = await db
    .update(recognitions)
    .set({
      status: 'failed',
      errorCode: 'read_failed',
      errorMessage: failureMessages.read_failed,
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(recognitions.regionId, regionId),
        inArray(recognitions.status, [...activeRecognitionStatuses]),
        lt(recognitions.createdAt, new Date(Date.now() - staleAfterMs)),
      ),
    )
    .returning({ id: recognitions.id })
  return rows.length
}

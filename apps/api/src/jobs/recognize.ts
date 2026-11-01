import { lineSchema, type Hints, type Line, type RecognitionFailureCode } from '@khronist/contracts'
import { and, eq, inArray, lt, sql } from 'drizzle-orm'
import { uuidv7 } from 'uuidv7'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import {
  entities,
  lineWords,
  recognitions,
  transcriptionLines,
  transcriptions,
} from '../db/schema.ts'
import { runWithTimeout } from '../lib/timeout.ts'
import type { HtrReader } from '../services/htr/index.ts'
import type { Normalized, Normalizer } from '../services/normalize.ts'
import type { EventHub } from './events.ts'

export const activeStatuses = ['queued', 'reading', 'normalizing'] as const

const insertChunk = 2000

export const failureMessages: Record<RecognitionFailureCode, string> = {
  read_failed: 'Не вдалося прочитати фрагмент',
  normalize_failed: 'Не вдалося обробити прочитаний текст',
  save_failed: 'Не вдалося зберегти результат',
  restarted: 'Сервер було перезапущено, спробуйте ще раз',
  bad_image: 'Не вдалося обробити зображення',
  too_large: 'Зображення завелике',
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
  and(eq(recognitions.id, id), inArray(recognitions.status, [...activeStatuses]))

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

const markFailed = async (db: Database, id: string, code: RecognitionFailureCode) => {
  await db
    .update(recognitions)
    .set({
      status: 'failed',
      errorCode: code,
      errorMessage: failureMessages[code],
      finishedAt: new Date(),
    })
    .where(isActive(id))
}

const chunked = <T>(rows: T[], size: number): T[][] => {
  const parts: T[][] = []
  for (let i = 0; i < rows.length; i += size) parts.push(rows.slice(i, i + size))
  return parts
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
  readerName: string,
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

    const [latest] = await tx
      .select({ version: sql<number>`coalesce(max(${transcriptions.version}), 0)` })
      .from(transcriptions)
      .where(eq(transcriptions.regionId, recognition.regionId))

    const [transcription] = await tx
      .insert(transcriptions)
      .values({
        regionId: recognition.regionId,
        version: (latest?.version ?? 0) + 1,
        rawText: lines.map((line) => line.text).join('\n'),
        normalizedText: normalized.normalizedText,
        reader: readerName,
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
    for (const part of chunked(wordRows, insertChunk)) await tx.insert(lineWords).values(part)

    const entityRows = normalized.entities.map((entity) => ({
      transcriptionId: transcription.id,
      type: entity.type,
      text: entity.text,
      normalized: entity.normalized ?? null,
      wikidataId: entity.wikidataId ?? null,
      startPos: entity.start,
      endPos: entity.end,
      extra: entity.extra ?? null,
    }))
    for (const part of chunked(entityRows, insertChunk)) await tx.insert(entities).values(part)

    const closed = await tx
      .update(recognitions)
      .set({
        status: 'done',
        transcriptionId: transcription.id,
        errorCode: null,
        errorMessage: null,
        finishedAt: new Date(),
      })
      .where(isActive(recognitionId))
      .returning({ id: recognitions.id })
    if (closed.length === 0) throw new JobCancelledError()
    return transcription.id
  })

export const runRecognition = async (deps: JobDeps, job: RecognitionJob): Promise<void> => {
  const { db, reader, normalizer, hub, log } = deps
  const { recognitionId } = job
  let stage: Stage = 'read'
  let transcriptionId: string
  try {
    await setStatus(db, recognitionId, 'reading')
    hub.publish(recognitionId, { event: 'progress', data: { status: 'reading' } })

    const lines = checkLines(
      await runWithTimeout(
        (signal) => reader.read({ image: job.image, hints: job.hints, signal }),
        deps.readTimeoutMs ?? 30_000,
        'reading',
      ),
    )
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
    transcriptionId = await saveTranscription(db, recognitionId, reader.name, lines, normalized)
  } catch (error) {
    if (error instanceof JobCancelledError) {
      log.error({ err: error, recognitionId }, 'recognition cancelled')
      hub.publish(recognitionId, {
        event: 'failed',
        data: { code: 'restarted', message: failureMessages.restarted },
      })
      return
    }
    const code = failureCodeFor[stage]
    log.error({ err: error, recognitionId, stage }, 'recognition failed')
    await markFailed(db, recognitionId, code).catch((markError: unknown) =>
      log.error({ err: markError, recognitionId }, 'could not record the failure'),
    )
    hub.publish(recognitionId, { event: 'failed', data: { code, message: failureMessages[code] } })
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
    .where(inArray(recognitions.status, [...activeStatuses]))
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
        inArray(recognitions.status, [...activeStatuses]),
        lt(recognitions.createdAt, new Date(Date.now() - staleAfterMs)),
      ),
    )
    .returning({ id: recognitions.id })
  return rows.length
}

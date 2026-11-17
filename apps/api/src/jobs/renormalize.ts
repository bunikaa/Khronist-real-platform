import type { Entity } from '@khronist/contracts'
import { and, eq, gt, isNotNull, isNull, lt } from 'drizzle-orm'
import PQueue from 'p-queue'
import type { Database } from '../db/client.ts'
import { entities, transcriptions } from '../db/schema.ts'
import {
  entitiesTimeoutMs,
  normalizeTimeoutMs,
  renormalizeBacklog,
  renormalizeBudgetShare,
  renormalizeConcurrency,
  translateTimeoutMs,
} from '../lib/limits.ts'
import { runWithTimeout } from '../lib/timeout.ts'
import type { EntityExtractor } from '../services/entities.ts'
import type { CallBudget } from '../services/llm/index.ts'
import { assertNormalized, type Normalizer } from '../services/normalize.ts'
import { insertEntities, loadLines, normalizedTextOf } from '../services/transcriptions.ts'
import type { Translator } from '../services/translate.ts'
import { findEntities, findTranslation } from './enrichment.ts'
import { isAbort } from './queue.ts'
import type { JobLogger } from './logger.ts'

type RenormalizeDeps = {
  db: Database
  normalizer: Normalizer
  entities: EntityExtractor
  translator: Translator
  budget: CallBudget
  log: JobLogger
  normalizeTimeoutMs?: number | undefined
  entitiesTimeoutMs?: number | undefined
  translateTimeoutMs?: number | undefined
}

type RenormalizeOutcome = 'normalized' | 'skipped'

const hasVersion = async (db: Database, condition: ReturnType<typeof and>) => {
  const [row] = await db
    .select({ id: transcriptions.id })
    .from(transcriptions)
    .where(condition)
    .limit(1)
  return row !== undefined
}

type Renormalized = {
  newer: ReturnType<typeof and>
  values: Pick<
    typeof transcriptions.$inferInsert,
    'normalizedText' | 'normalizedLines' | 'expansions' | 'translatedLines'
  >
  found: Entity[]
}

const saveRenormalized = (
  db: Database,
  transcriptionId: string,
  { newer, values, found }: Renormalized,
): Promise<RenormalizeOutcome> =>
  db.transaction(async (tx) => {
    await tx
      .select({ id: transcriptions.id })
      .from(transcriptions)
      .where(eq(transcriptions.id, transcriptionId))
      .for('update')
    if (await hasVersion(tx, newer)) return 'skipped'
    const updated = await tx
      .update(transcriptions)
      .set(values)
      .where(and(eq(transcriptions.id, transcriptionId), isNull(transcriptions.normalizedLines)))
      .returning({ id: transcriptions.id })
    if (updated.length === 0) return 'skipped'
    await tx.delete(entities).where(eq(entities.transcriptionId, transcriptionId))
    await insertEntities(tx, transcriptionId, found)
    return 'normalized'
  })

export const renormalizeVersion = async (
  deps: RenormalizeDeps,
  transcriptionId: string,
  stopped?: AbortSignal | undefined,
): Promise<RenormalizeOutcome> => {
  const { db, normalizer } = deps
  const log = deps.log.child({ transcriptionId })
  const [version] = await db
    .select({
      regionId: transcriptions.regionId,
      version: transcriptions.version,
      normalizedLines: transcriptions.normalizedLines,
    })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId))
    .limit(1)
  if (!version || version.normalizedLines !== null) return 'skipped'

  const sameRegion = eq(transcriptions.regionId, version.regionId)
  const newer = and(sameRegion, gt(transcriptions.version, version.version))
  if (await hasVersion(db, newer)) return 'skipped'
  const normalizedBefore = and(
    sameRegion,
    lt(transcriptions.version, version.version),
    isNotNull(transcriptions.normalizedLines),
  )
  if (!(await hasVersion(db, normalizedBefore))) {
    log.info({}, 'no earlier version was normalized, keeping the lines as edited')
    return 'skipped'
  }
  if (!(await deps.budget.available(renormalizeBudgetShare))) {
    log.warn({}, 'the rest of the model budget is kept for readings, keeping the lines as edited')
    return 'skipped'
  }

  const lines = await loadLines(db, transcriptionId)
  const output = await runWithTimeout(
    (signal) => normalizer.normalize({ lines, signal, log }),
    deps.normalizeTimeoutMs ?? normalizeTimeoutMs,
    'normalization',
    stopped,
  )
  if (!output) return 'skipped'
  assertNormalized(lines, output)
  if (await hasVersion(db, newer)) return 'skipped'
  const normalizedText = normalizedTextOf(lines, output)
  const translating = await deps.budget
    .available(renormalizeBudgetShare)
    .catch((error: unknown) => {
      log.error({ err: error }, 'could not read the model budget')
      return false
    })
  if (!translating) {
    log.warn({}, 'the rest of the model budget is kept for readings, skipping the translation')
  }
  const [found, translatedLines] = await Promise.all([
    findEntities(deps.entities, {
      normalizedText,
      log,
      timeoutMs: deps.entitiesTimeoutMs ?? entitiesTimeoutMs,
      stopped,
    }),
    findTranslation(deps.translator, {
      normalized: translating ? output : null,
      log,
      timeoutMs: deps.translateTimeoutMs ?? translateTimeoutMs,
      stopped,
    }),
  ])

  return saveRenormalized(db, transcriptionId, {
    newer,
    values: {
      normalizedText,
      normalizedLines: output.lines,
      expansions: output.expansions,
      translatedLines,
    },
    found,
  })
}

export type Renormalizer = {
  schedule: (transcriptionId: string) => boolean
  onIdle: () => Promise<void>
  stop: () => void
}

type RenormalizerOptions = RenormalizeDeps & {
  concurrency?: number | undefined
  backlog?: number | undefined
}

export const createRenormalizer = (options: RenormalizerOptions): Renormalizer => {
  const queue = new PQueue({ concurrency: options.concurrency ?? renormalizeConcurrency })
  const backlog = options.backlog ?? renormalizeBacklog
  const stopping = new AbortController()
  return {
    schedule: (transcriptionId) => {
      if (stopping.signal.aborted || queue.size + queue.pending >= backlog) {
        options.log.warn({ transcriptionId }, 'renormalization was not scheduled')
        return false
      }
      queue
        .add(() => renormalizeVersion(options, transcriptionId, stopping.signal))
        .catch((error: unknown) => {
          if (stopping.signal.aborted || isAbort(error)) return
          options.log.warn(
            { err: error, transcriptionId },
            'renormalization failed, keeping the lines as edited',
          )
        })
      return true
    },
    onIdle: () => queue.onIdle(),
    stop: () => {
      options.log.info(
        { dropped: queue.size, cut: queue.pending },
        'renormalization stopped, the versions keep the lines as edited',
      )
      queue.clear()
      stopping.abort(new Error('the server is shutting down'))
    },
  }
}

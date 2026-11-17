import type { Entity, Hints, NormalizeOutput } from '@khronist/contracts'
import { runWithTimeout } from '../lib/timeout.ts'
import { assertEntitiesFit, type EntityExtractor } from '../services/entities.ts'
import type { Translator } from '../services/translate.ts'
import type { JobLogger } from './logger.ts'

type Enrichment = {
  hints?: Hints | undefined
  log: JobLogger
  timeoutMs: number
  stopped?: AbortSignal | undefined
}

export const findEntities = (
  extractor: EntityExtractor,
  { normalizedText, hints, log, timeoutMs, stopped }: Enrichment & { normalizedText: string },
): Promise<Entity[]> =>
  runWithTimeout(
    (signal) => extractor.extract({ normalizedText, hints, signal, log }),
    timeoutMs,
    'entities',
    stopped,
  )
    .then((found) => assertEntitiesFit(normalizedText, found))
    .catch((error: unknown) => {
      if (stopped?.aborted) throw error
      log.warn({ err: error }, 'entities failed, keeping the text without them')
      return []
    })

export const findTranslation = async (
  translator: Translator,
  {
    normalized,
    hints,
    log,
    timeoutMs,
    stopped,
  }: Enrichment & { normalized: NormalizeOutput | null },
): Promise<string[] | null> => {
  if (!normalized) return null
  const lines = normalized.lines.map((line) => line.text)
  return runWithTimeout(
    (signal) => translator.translate({ lines, hints, signal, log }),
    timeoutMs,
    'translation',
    stopped,
  )
    .then((output) => output?.lines ?? null)
    .catch((error: unknown) => {
      if (stopped?.aborted) throw error
      log.warn({ err: error }, 'translation failed, keeping the text without it')
      return null
    })
}

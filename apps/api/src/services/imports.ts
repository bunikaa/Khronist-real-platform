import {
  boxSchema,
  entitiesOutputSchema,
  htrVisionOutputSchema,
  lineTextSchema,
  normalizeOutputSchema,
  readingWarningSchema,
  translateOutputSchema,
  visionToLines,
  type Box,
} from '@khronist/contracts'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { regions } from '../db/schema.ts'
import { assertEntitiesFit, placeEntities, withNewStyleDates } from './entities.ts'
import { assertNormalized } from './normalize.ts'
import { translationProblem } from './translate.ts'
import { insertTranscriptionVersion, normalizedTextOf, type NewVersion } from './transcriptions.ts'

export const batchReader = 'khronist-batch'

export const readingRecordSchema = z.object({
  box: boxSchema,
  warnings: z.array(readingWarningSchema).default([]),
  lines: htrVisionOutputSchema.shape.lines.min(1),
  normalized: normalizeOutputSchema.shape.lines,
  expansions: normalizeOutputSchema.shape.expansions.default([]),
  translated: translateOutputSchema.shape.lines,
  entities: entitiesOutputSchema.shape.entities.default([]),
})
export type ReadingRecord = z.infer<typeof readingRecordSchema>

export type ReadVersion = Omit<NewVersion, 'regionId'>

const lineProblem = (line: ReadingRecord['lines'][number], index: number) => {
  const text = lineTextSchema.safeParse(line.text)
  if (!text.success) return `line ${index}: ${text.error.issues[0]?.message ?? 'is not valid'}`
  if (line.words.map((word) => word.text).join(' ') !== line.text) {
    return `the words of line ${index} do not add up to its text`
  }
  if (/[Өө]/u.test(line.text)) return `line ${index} writes the fita as Ө instead of Ѳ`
  return undefined
}

export const versionOfReading = (record: ReadingRecord): ReadVersion => {
  const problem = record.lines.map(lineProblem).find((found) => found !== undefined)
  if (problem) throw new Error(problem)
  const lines = visionToLines({ lines: record.lines, warnings: [] })
  const normalized = assertNormalized(lines, {
    lines: record.normalized,
    expansions: record.expansions,
  })
  const translation = translationProblem(
    normalized.lines.map((line) => line.text),
    { lines: record.translated },
  )
  if (translation) throw new Error(translation)
  const text = normalizedTextOf(lines, normalized)
  const { placed, dropped } = placeEntities(text, record.entities)
  if (dropped > 0) throw new Error(`${dropped} entities do not match the normalized text`)
  return {
    reader: batchReader,
    lines,
    warnings: [...new Set(record.warnings)],
    normalized,
    translatedLines: record.translated,
    entities: assertEntitiesFit(text, withNewStyleDates(placed)),
  }
}

type RecordPlace = { pageId: string; box: Box; imageHash: string }

export const importRecord = (
  db: Database,
  { pageId, box, imageHash }: RecordPlace,
  version: ReadVersion,
): Promise<'created' | 'exists'> =>
  db.transaction(async (tx) => {
    const [region] = await tx
      .insert(regions)
      .values({ pageId, ...box, imageHash })
      .onConflictDoNothing({ target: regions.imageHash })
      .returning({ id: regions.id })
    if (!region) return 'exists'
    await insertTranscriptionVersion(tx, { regionId: region.id, ...version })
    return 'created'
  })

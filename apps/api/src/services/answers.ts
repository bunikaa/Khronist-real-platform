import { answerConfidenceSchema, citationSchema, type Citation } from '@khronist/contracts'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import type { Database } from '../db/client.ts'
import { transcriptions } from '../db/schema.ts'
import { maxRecordChars } from '../lib/limits.ts'
import type { retrieve } from './retrieval.ts'

export type FoundChunk = Awaited<ReturnType<typeof retrieve>>['chunks'][number]

export const anyCaseConfidenceSchema = z.preprocess(
  (value) => (typeof value === 'string' ? value.toLowerCase() : value),
  answerConfidenceSchema,
)

export const chunkCitationOf = (chunk: FoundChunk, quote: string): Citation => ({
  kind: 'chunk',
  chunkId: chunk.id,
  sourceId: chunk.sourceId,
  title: chunk.title,
  ...(citationSchema.shape.url.safeParse(chunk.url).success && { url: chunk.url }),
  licence: chunk.licence,
  retelling: true,
  quote,
})

export const promptChunksOf = (found: FoundChunk[]): string =>
  JSON.stringify(found.map(({ id, title, text }) => ({ chunkId: id, title, text })))

export type TranscriptionRecord = { transcriptionId: string; text: string }

export const recordOf = async (
  db: Database,
  transcriptionId: string | undefined,
): Promise<TranscriptionRecord | null> => {
  if (!transcriptionId) return null
  const [row] = await db
    .select({ transcriptionId: transcriptions.id, text: transcriptions.normalizedText })
    .from(transcriptions)
    .where(eq(transcriptions.id, transcriptionId))
  const text = row?.text.slice(0, maxRecordChars) ?? ''
  return row && text.trim().length > 0 ? { transcriptionId: row.transcriptionId, text } : null
}

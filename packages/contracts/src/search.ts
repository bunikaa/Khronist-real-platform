import { z } from 'zod'
import { shelfmarkSchema, transcriptionStatusSchema } from './common.ts'

export const searchQuerySchema = z.object({
  q: z.string().min(1),
  archive: z.string().optional(),
  fond: z.string().optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  verifiedOnly: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().optional(),
})
export type SearchQuery = z.infer<typeof searchQuerySchema>

export const searchResponseSchema = z.object({
  items: z.array(
    z.object({
      transcriptionId: z.uuid(),
      shelfmark: shelfmarkSchema,
      year: z.number().int().optional(),
      snippet: z.string(),
      status: transcriptionStatusSchema,
      portalUrl: z.httpUrl().optional(),
    }),
  ),
  nextCursor: z.string().optional(),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const citeRequestSchema = z.object({
  transcriptionId: z.uuid(),
  format: z.enum(['dstu', 'markdown', 'text']),
  withTranscription: z.boolean(),
})
export type CiteRequest = z.infer<typeof citeRequestSchema>

export const citeResponseSchema = z.object({ text: z.string() })
export type CiteResponse = z.infer<typeof citeResponseSchema>

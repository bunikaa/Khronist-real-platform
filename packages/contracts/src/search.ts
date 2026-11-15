import { z } from 'zod'
import {
  boxSchema,
  shelfmarkBaseSchema,
  shelfmarkSchema,
  transcriptionStatusSchema,
} from './common.ts'
import { yearSchema } from './recognitions.ts'

export const maxSearchQueryLength = 200

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1).max(maxSearchQueryLength),
  archive: z.string().optional(),
  fond: z.string().optional(),
  yearFrom: z.coerce.number().pipe(yearSchema).optional(),
  yearTo: z.coerce.number().pipe(yearSchema).optional(),
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
      yearFrom: yearSchema.optional(),
      yearTo: yearSchema.optional(),
      snippet: z.string(),
      status: transcriptionStatusSchema,
      portalUrl: z.httpUrl().optional(),
    }),
  ),
  nextCursor: z.string().optional(),
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

export const transcriptionSummarySchema = z.object({
  id: z.uuid(),
  regionId: z.uuid(),
  box: boxSchema,
  version: z.number().int().min(1),
  status: transcriptionStatusSchema,
  createdAt: z.iso.datetime(),
})
export type TranscriptionSummary = z.infer<typeof transcriptionSummarySchema>

export const pageLookupQuerySchema = shelfmarkBaseSchema
  .pick({ archive: true, fond: true, opys: true, sprava: true, folio: true })
  .extend({
    image: z.coerce.number().pipe(shelfmarkBaseSchema.shape.image.unwrap()).optional(),
  })
  .refine((query) => query.folio !== undefined || query.image !== undefined, {
    message: 'folio or image is required',
    path: ['folio'],
  })
export type PageLookupQuery = z.infer<typeof pageLookupQuerySchema>

export const pageLookupResponseSchema = z.object({
  page: z
    .object({
      id: z.uuid(),
      shelfmark: shelfmarkSchema,
      transcriptions: z.array(transcriptionSummarySchema),
    })
    .optional(),
})
export type PageLookupResponse = z.infer<typeof pageLookupResponseSchema>

export const citeRequestSchema = z.object({
  transcriptionId: z.uuid(),
  format: z.enum(['dstu', 'markdown', 'text']),
  withTranscription: z.boolean(),
})
export type CiteRequest = z.infer<typeof citeRequestSchema>

export const citeResponseSchema = z.object({ text: z.string() })
export type CiteResponse = z.infer<typeof citeResponseSchema>

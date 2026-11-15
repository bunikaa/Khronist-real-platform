import { z } from 'zod'
import {
  boxSchema,
  entitySchema,
  hintsSchema,
  lineSchema,
  readingWarningSchema,
  recognitionStatusSchema,
  shelfmarkSchema,
  transcriptionStatusSchema,
  withoutControlCharacters,
} from './common.ts'
import { normalizeOutputSchema } from './normalize.ts'

export const yearSchema = z.number().int().min(1000).max(2100)

export const transcriptionSchema = z.object({
  id: z.uuid(),
  regionId: z.uuid(),
  shelfmark: shelfmarkSchema.optional(),
  box: boxSchema,
  version: z.number().int().min(1),
  status: transcriptionStatusSchema,
  lines: z.array(lineSchema),
  normalizedText: z.string(),
  normalizedLines: normalizeOutputSchema.shape.lines.optional(),
  expansions: normalizeOutputSchema.shape.expansions.optional(),
  entities: z.array(entitySchema),
  warnings: z.array(readingWarningSchema).optional(),
  reader: z.string(),
  author: z.object({ name: z.string() }).optional(),
  verifiedBy: z.object({ name: z.string() }).optional(),
  verifiedSignature: z.string().optional(),
  verifiedAt: z.iso.datetime().optional(),
  createdAt: z.iso.datetime(),
})
export type Transcription = z.infer<typeof transcriptionSchema>

export const createRecognitionRequestSchema = z.object({
  shelfmark: shelfmarkSchema.optional(),
  image: z.object({ base64Png: z.string().min(1) }),
  box: boxSchema.optional(),
  imageHash: z.string().regex(/^[a-f0-9]{64}$/),
  source: z.enum(['extension', 'web', 'mcp', 'batch']),
  hints: hintsSchema.optional(),
  document: z
    .object({ yearFrom: yearSchema, yearTo: yearSchema })
    .refine((years) => years.yearFrom <= years.yearTo, { message: 'yearFrom after yearTo' })
    .optional(),
})
export type CreateRecognitionRequest = z.infer<typeof createRecognitionRequestSchema>

export const createRecognitionResponseSchema = z.object({
  recognitionId: z.uuid(),
  status: z.enum(['queued', 'cached']),
  transcriptionId: z.uuid().optional(),
})
export type CreateRecognitionResponse = z.infer<typeof createRecognitionResponseSchema>

export const recognitionFailureCodeSchema = z.enum([
  'read_failed',
  'no_text',
  'normalize_failed',
  'restarted',
  'bad_image',
  'too_large',
  'save_failed',
])
export type RecognitionFailureCode = z.infer<typeof recognitionFailureCodeSchema>

export const recognitionStateSchema = z.object({
  recognitionId: z.uuid(),
  status: recognitionStatusSchema,
  transcription: transcriptionSchema.optional(),
  error: z.object({ code: recognitionFailureCodeSchema, message: z.string() }).optional(),
})
export type RecognitionState = z.infer<typeof recognitionStateSchema>

export const recognitionEventSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('progress'), data: z.object({ status: recognitionStatusSchema }) }),
  z.object({ event: z.literal('line'), data: z.object({ line: lineSchema }) }),
  z.object({ event: z.literal('done'), data: z.object({ transcriptionId: z.uuid() }) }),
  z.object({
    event: z.literal('failed'),
    data: z.object({ code: recognitionFailureCodeSchema, message: z.string() }),
  }),
])
export type RecognitionEvent = z.infer<typeof recognitionEventSchema>

export const maxPatchedLines = 200
export const maxLineLength = 500
export const maxSignatureLength = 80

export const patchLinesRequestSchema = z.object({
  baseVersion: z.number().int().min(1),
  lines: z
    .array(
      z.object({
        idx: z.number().int().min(0),
        text: z
          .string()
          .max(maxLineLength)
          .refine((text) => !/[\r\n]/.test(text), { message: 'a line has no line breaks' }),
      }),
    )
    .min(1)
    .max(maxPatchedLines)
    .refine((lines) => new Set(lines.map((line) => line.idx)).size === lines.length, {
      message: 'each line index appears once',
    }),
})
export type PatchLinesRequest = z.infer<typeof patchLinesRequestSchema>

export const verifyRequestSchema = z.object({
  signature: z
    .string()
    .trim()
    .min(1)
    .max(maxSignatureLength)
    .refine(withoutControlCharacters, { message: 'control character' })
    .optional(),
})
export type VerifyRequest = z.infer<typeof verifyRequestSchema>

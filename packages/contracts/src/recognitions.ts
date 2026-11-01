import { z } from 'zod'
import {
  boxSchema,
  entitySchema,
  hintsSchema,
  lineSchema,
  recognitionStatusSchema,
  shelfmarkSchema,
  transcriptionStatusSchema,
} from './common.ts'

export const transcriptionSchema = z.object({
  id: z.uuid(),
  regionId: z.uuid(),
  shelfmark: shelfmarkSchema.optional(),
  box: boxSchema,
  version: z.number().int().min(1),
  status: transcriptionStatusSchema,
  lines: z.array(lineSchema),
  normalizedText: z.string(),
  entities: z.array(entitySchema),
  reader: z.string(),
  author: z.object({ name: z.string() }).optional(),
  verifiedBy: z.object({ name: z.string() }).optional(),
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

export const patchLinesRequestSchema = z.object({
  baseVersion: z.number().int().min(1),
  lines: z.array(z.object({ idx: z.number().int().min(0), text: z.string() })).min(1),
})
export type PatchLinesRequest = z.infer<typeof patchLinesRequestSchema>

export const verifyRequestSchema = z.object({ signature: z.string().min(1).optional() })
export type VerifyRequest = z.infer<typeof verifyRequestSchema>

import { z } from 'zod'
import { hintsSchema, lineSchema } from './common.ts'

export const htrRequestSchema = z.object({
  image: z.object({ base64Png: z.string().min(1) }),
  hints: hintsSchema.optional(),
  options: z
    .object({ returnWords: z.boolean().optional(), maxLines: z.number().int().min(1).optional() })
    .optional(),
})
export type HtrRequest = z.infer<typeof htrRequestSchema>

export const htrResponseSchema = z.object({
  lines: z.array(lineSchema.extend({ boxSource: z.literal('model') })),
  model: z.object({ name: z.string(), revision: z.string() }),
  timing: z.object({ segmentMs: z.number(), ocrMs: z.number(), totalMs: z.number() }),
  warnings: z.array(z.string()).optional(),
})
export type HtrResponse = z.infer<typeof htrResponseSchema>

export const htrVisionOutputSchema = z.object({
  lines: z.array(
    z.object({
      text: z.string(),
      words: z.array(z.object({ text: z.string(), uncertain: z.boolean() })),
    }),
  ),
  warnings: z.array(z.string()).default([]),
})
export type HtrVisionOutput = z.infer<typeof htrVisionOutputSchema>

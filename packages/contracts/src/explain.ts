import { z } from 'zod'
import { citationSchema } from './common.ts'

const noAnswerReason = z.literal('no_sources')

export const answerConfidenceSchema = z.enum(['high', 'low'])
export type AnswerConfidence = z.infer<typeof answerConfidenceSchema>

export const explainRequestSchema = z.object({
  kind: z.enum(['term', 'place', 'date', 'entity']),
  text: z.string().min(1),
  context: z
    .object({ transcriptionId: z.uuid().optional(), period: z.string().optional() })
    .optional(),
})
export type ExplainRequest = z.infer<typeof explainRequestSchema>

export const explainResponseSchema = z.object({
  answer: z.string().nullable(),
  reason: noAnswerReason.optional(),
  confidence: answerConfidenceSchema.optional(),
  citations: z.array(citationSchema),
  place: z
    .object({ modernName: z.string(), region: z.string(), wikidataId: z.string() })
    .optional(),
  date: z.object({ julian: z.string(), gregorian: z.string(), weekday: z.string() }).optional(),
})
export type ExplainResponse = z.infer<typeof explainResponseSchema>

export const explainOutputSchema = z.object({
  answer: z.string().nullable(),
  confidence: answerConfidenceSchema,
  citations: z.array(z.object({ chunkId: z.string(), quote: z.string() })),
})
export type ExplainOutput = z.infer<typeof explainOutputSchema>

export const chatRequestSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  context: z.object({ transcriptionId: z.uuid().optional() }).optional(),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export const chatResponseSchema = z.object({
  answer: z.string().nullable(),
  reason: noAnswerReason.optional(),
  citations: z.array(citationSchema),
  followups: z.array(z.string()),
})
export type ChatResponse = z.infer<typeof chatResponseSchema>

export const hasValidAnswer = (r: { answer: string | null; citations: unknown[] }): boolean =>
  r.answer !== null && r.citations.length > 0

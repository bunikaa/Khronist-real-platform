import { z } from 'zod'
import { citationSchema, hintsSchema, recordCitationSchema } from './common.ts'

const noAnswerReason = z.literal('no_sources')

export const answerConfidenceSchema = z.enum(['high', 'low'])
export type AnswerConfidence = z.infer<typeof answerConfidenceSchema>

export const maxExplainTextLength = 200
export const maxChatMessages = 20
export const maxChatMessageLength = 2000

export const minQuoteCharacters = 15
export const minQuoteWords = 3

const wordCharacter = /[\p{L}\p{N}]/u

export const isGroundedQuote = (quote: string, source: string): boolean => {
  const text = quote.trim()
  const words = text.split(/\s+/).filter(Boolean).length
  if (text.length < minQuoteCharacters && words < minQuoteWords) return false
  for (let at = source.indexOf(text); at !== -1; at = source.indexOf(text, at + 1)) {
    const before = source[at - 1] ?? ''
    const after = source[at + text.length] ?? ''
    if (!wordCharacter.test(before) && !wordCharacter.test(after)) return true
  }
  return false
}

export const explainRequestSchema = z.object({
  kind: z.enum(['term', 'place', 'date', 'entity']),
  text: z.string().trim().min(1).max(maxExplainTextLength),
  context: z
    .object({ transcriptionId: z.uuid().optional(), period: hintsSchema.shape.period })
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
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(maxChatMessageLength),
      }),
    )
    .min(1)
    .max(maxChatMessages)
    .refine((messages) => messages.at(-1)?.role === 'user', {
      message: 'the last message must be a question from the user',
    }),
  context: z
    .object({ transcriptionId: z.uuid().optional(), period: hintsSchema.shape.period })
    .optional(),
})
export type ChatRequest = z.infer<typeof chatRequestSchema>

export const chatResponseSchema = z.object({
  answer: z.string().nullable(),
  reason: noAnswerReason.optional(),
  confidence: answerConfidenceSchema.optional(),
  citations: z.array(z.discriminatedUnion('kind', [citationSchema, recordCitationSchema])),
  followups: z.array(z.string()),
})
export type ChatResponse = z.infer<typeof chatResponseSchema>

export const chatOutputSchema = z.object({
  answer: z.string().nullable(),
  confidence: answerConfidenceSchema,
  citations: z.array(
    z.union([
      z.object({ source: z.literal('record'), quote: z.string() }),
      z.object({ source: z.literal('chunk'), chunkId: z.string(), quote: z.string() }),
    ]),
  ),
  followups: z.array(z.string()),
})
export type ChatOutput = z.infer<typeof chatOutputSchema>

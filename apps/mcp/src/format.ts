import { z } from 'zod'
import {
  entitySchema,
  explainResponseSchema,
  hintsSchema,
  maxExplainTextLength,
  readingWarningSchema,
  shelfmarkSchema,
  type ExplainResponse,
  type Shelfmark,
  type Transcription,
} from '@khronist/contracts'

export const transcribeInput = {
  image_base64: z.string().min(1).describe('PNG-фрагмент скану в base64, без префікса data:'),
  shelfmark: shelfmarkSchema.optional().describe('Шифр аркуша, якщо відомий'),
  hints: hintsSchema.optional(),
}

export const transcribeOutput = z.object({
  transcription_id: z.string(),
  shelfmark: z.string().optional(),
  lines: z.array(z.object({ idx: z.number().int(), text: z.string(), uncertain: z.boolean() })),
  normalized_text: z.string(),
  entities: z.array(
    z.object({
      type: entitySchema.shape.type,
      text: z.string(),
      normalized: z.string().optional(),
    }),
  ),
  warnings: z.array(readingWarningSchema).optional(),
})
export type TranscribeOutput = z.infer<typeof transcribeOutput>

export const explainInput = {
  kind: z.enum(['term', 'place', 'date', 'entity']),
  text: z
    .string()
    .trim()
    .min(1)
    .max(maxExplainTextLength)
    .describe('Слово чи вираз так, як він стоїть у документі'),
  period: hintsSchema.shape.period.describe('Століття документа: 17, 18, 19 або 20'),
}

export const explainOutput = z.object({
  answer: z.string().nullable(),
  reason: explainResponseSchema.shape.reason,
  confidence: explainResponseSchema.shape.confidence,
  citations: z.array(
    z.object({
      title: z.string(),
      url: z.string().optional(),
      licence: z.string(),
      retelling: z.boolean(),
      quote: z.string(),
    }),
  ),
})
export type ExplainOutput = z.infer<typeof explainOutput>

export const shelfmarkLabel = (shelfmark: Shelfmark): string => {
  const page =
    shelfmark.folio === undefined ? `зобр. ${shelfmark.image}` : `арк. ${shelfmark.folio}`
  return `${shelfmark.archive}, ф. ${shelfmark.fond}, оп. ${shelfmark.opys}, спр. ${shelfmark.sprava}, ${page}`
}

export const toTranscribeOutput = (transcription: Transcription): TranscribeOutput => ({
  transcription_id: transcription.id,
  shelfmark: transcription.shelfmark && shelfmarkLabel(transcription.shelfmark),
  lines: transcription.lines.map(({ idx, text, uncertain }) => ({ idx, text, uncertain })),
  normalized_text: transcription.normalizedText,
  entities: transcription.entities.map(({ type, text, normalized }) => ({
    type,
    text,
    normalized,
  })),
  warnings: transcription.warnings,
})

export const toExplainOutput = (response: ExplainResponse): ExplainOutput => ({
  answer: response.answer,
  reason: response.reason,
  confidence: response.confidence,
  citations: response.citations.map(({ title, url, licence, retelling, quote }) => ({
    title,
    url,
    licence,
    retelling,
    quote,
  })),
})

export const explainNote = (output: ExplainOutput): string | undefined => {
  if (output.answer === null) return 'Не знаю: у довідковому корпусі немає джерел для відповіді.'
  if (output.confidence === 'low')
    return 'Часткова відповідь: джерела підтверджують її не повністю.'
  return undefined
}

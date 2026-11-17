import { z } from 'zod'
import {
  entitySchema,
  explainResponseSchema,
  hintsSchema,
  maxExplainTextLength,
  maxSearchQueryLength,
  readingWarningSchema,
  shelfmarkSchema,
  transcriptionStatusSchema,
  type ExplainResponse,
  type SearchResponse,
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

export const searchInput = {
  query: z
    .string()
    .trim()
    .min(1)
    .max(maxSearchQueryLength)
    .describe("Ім'я, прізвище, село чи слово з документа"),
  verified_only: z.boolean().optional().describe('Лише транскрипції, підтверджені людиною'),
  limit: z.number().int().min(1).max(50).optional().describe('Скільки результатів, типово 20'),
}

export const searchOutput = z.object({
  items: z.array(
    z.object({
      transcription_id: z.string(),
      shelfmark: z.string(),
      year_from: z.number().int().optional(),
      year_to: z.number().int().optional(),
      snippet: z.string(),
      status: transcriptionStatusSchema,
      portal_url: z.string().optional(),
    }),
  ),
})
export type SearchOutput = z.infer<typeof searchOutput>

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

export const toSearchOutput = (response: SearchResponse): SearchOutput => ({
  items: response.items.map((item) => ({
    transcription_id: item.transcriptionId,
    shelfmark: shelfmarkLabel(item.shelfmark),
    year_from: item.yearFrom,
    year_to: item.yearTo,
    snippet: item.snippet,
    status: item.status,
    portal_url: item.portalUrl,
  })),
})

export const explainNote = (output: ExplainOutput): string | undefined => {
  if (output.answer === null) return 'Не знаю: у довідковому корпусі немає джерел для відповіді.'
  if (output.confidence === 'low')
    return 'Часткова відповідь: джерела підтверджують її не повністю.'
  return undefined
}

export const searchNote = (output: SearchOutput): string | undefined => {
  if (output.items.length === 0) return 'У Commons нічого не знайдено за цим запитом.'
  if (output.items.some((item) => item.status !== 'verified'))
    return 'Частина результатів — чернетки або спірні версії: їх не перевіряла людина.'
  return undefined
}

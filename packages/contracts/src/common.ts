import { z } from 'zod'

const shelfmarkPart = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => !/\p{Cc}/u.test(value), { message: 'control character' })

const maxImageNumber = 100000
const maxPortalUrlLength = 2048

const portalUrlSchema = z.httpUrl().refine(
  (value) => {
    if (value.length > maxPortalUrlLength) return false
    const url = new URL(value)
    return url.username === '' && url.password === ''
  },
  { message: 'portal link must be short and without credentials' },
)

export const shelfmarkBaseSchema = z.object({
  archive: shelfmarkPart,
  fond: shelfmarkPart,
  opys: shelfmarkPart,
  sprava: shelfmarkPart,
  folio: shelfmarkPart.optional(),
  image: z.number().int().min(1).max(maxImageNumber).optional(),
  portal: z.enum(['archium', 'own']).optional(),
  portalUrl: portalUrlSchema.optional(),
})

export const shelfmarkSchema = shelfmarkBaseSchema.refine(
  (s) => s.folio !== undefined || s.image !== undefined,
  { message: 'folio or image is required', path: ['folio'] },
)
export type Shelfmark = z.infer<typeof shelfmarkSchema>

const fraction = z.number().min(0).max(1)

const boxTolerance = 1.000001

export const boxSchema = z
  .object({
    x: fraction,
    y: fraction,
    w: fraction,
    h: fraction,
  })
  .refine((b) => b.w > 0 && b.h > 0 && b.x + b.w <= boxTolerance && b.y + b.h <= boxTolerance, {
    message: 'box must have a positive size and stay inside the image',
  })
export type Box = z.infer<typeof boxSchema>

export const wordSchema = z.object({
  text: z.string(),
  uncertain: z.boolean(),
  confidence: fraction.optional(),
})
export type Word = z.infer<typeof wordSchema>

export const lineSchema = z.object({
  idx: z.number().int().min(0),
  text: z.string(),
  box: boxSchema,
  boxSource: z.enum(['model', 'estimated']),
  uncertain: z.boolean(),
  words: z.array(wordSchema),
})
export type Line = z.infer<typeof lineSchema>

export const entitySchema = z.object({
  type: z.enum(['person', 'place', 'term', 'date']),
  text: z.string(),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  normalized: z.string().optional(),
  wikidataId: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
})
export type Entity = z.infer<typeof entitySchema>

export const citationSchema = z.object({
  chunkId: z.uuid(),
  sourceId: z.uuid(),
  title: z.string(),
  url: z.httpUrl().optional(),
  quote: z.string(),
})
export type Citation = z.infer<typeof citationSchema>

export const transcriptionStatusSchema = z.enum(['draft', 'verified', 'disputed'])
export type TranscriptionStatus = z.infer<typeof transcriptionStatusSchema>

export const recognitionStatusSchema = z.enum([
  'queued',
  'reading',
  'normalizing',
  'done',
  'failed',
])
export type RecognitionStatus = z.infer<typeof recognitionStatusSchema>

export const hintsSchema = z.object({
  language: z.enum(['uk', 'ru', 'church-slavonic', 'pl']).optional(),
  period: z.enum(['17', '18', '19', '20']).optional(),
  documentType: z.enum(['metric', 'revision', 'court', 'other']).optional(),
})
export type Hints = z.infer<typeof hintsSchema>

export const errorSchema = z.object({
  error: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    message: z.string(),
  }),
})
export type ApiError = z.infer<typeof errorSchema>

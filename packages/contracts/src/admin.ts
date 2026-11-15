import { z } from 'zod'

const century = z.number().int().min(1).max(21)

const inOrder = (item: { periodFrom: number; periodTo: number }) => item.periodFrom <= item.periodTo
const periodOrder = { message: 'periodFrom after periodTo' }

export const sourceLicenceSchema = z.enum(['суспільне надбання', 'CC BY-SA 4.0'])
export const sourceKindSchema = z.enum(['dictionary', 'encyclopedia', 'wikidata', 'publication'])
export const chunkTypeSchema = z.enum(['term', 'place', 'date', 'unit', 'abbr'])

export const adminSourcesRequestSchema = z.object({
  items: z
    .array(
      z
        .object({
          url: z.url({ protocol: /^https$/ }),
          title: z.string().trim().min(1),
          licence: sourceLicenceSchema,
          kind: sourceKindSchema,
          periodFrom: century,
          periodTo: century,
        })
        .refine(inOrder, periodOrder),
    )
    .min(1),
})
export type AdminSourcesRequest = z.infer<typeof adminSourcesRequestSchema>

export const adminSourcesResponseSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), url: z.string() })),
})
export type AdminSourcesResponse = z.infer<typeof adminSourcesResponseSchema>

export const adminChunksRequestSchema = z.object({
  items: z
    .array(
      z
        .object({
          articleKey: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
          idx: z.number().int().min(0),
          sourceId: z.uuid(),
          text: z.string().trim().min(1),
          topic: z.string().trim().min(1),
          type: chunkTypeSchema,
          periodFrom: century,
          periodTo: century,
          wikidataId: z
            .string()
            .regex(/^Q[1-9][0-9]*$/)
            .optional(),
        })
        .refine(inOrder, periodOrder),
    )
    .min(1)
    .refine(
      (items) =>
        new Set(items.map((item) => `${item.articleKey}#${item.idx}`)).size === items.length,
      { message: 'each articleKey and idx pair appears once' },
    ),
})
export type AdminChunksRequest = z.infer<typeof adminChunksRequestSchema>

export const adminChunksResponseSchema = z.object({
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
  deleted: z.number().int().min(0),
})
export type AdminChunksResponse = z.infer<typeof adminChunksResponseSchema>

export const adminSynonymsRequestSchema = z.object({
  items: z
    .array(
      z.object({
        term: z.string().trim().min(1),
        variant: z.string().trim().min(1),
        type: z.string().trim().min(1),
      }),
    )
    .min(1),
})
export type AdminSynonymsRequest = z.infer<typeof adminSynonymsRequestSchema>

export const adminSynonymsResponseSchema = z.object({
  inserted: z.number().int().min(0),
  updated: z.number().int().min(0),
  unchanged: z.number().int().min(0),
})
export type AdminSynonymsResponse = z.infer<typeof adminSynonymsResponseSchema>

export const adminStatsResponseSchema = z.object({
  recognitions: z.object({
    total: z.number().int().min(0),
    failed: z.number().int().min(0),
    p95Ms: z.number().min(0).nullable(),
  }),
  verifiedPages: z.number().int().min(0),
  modelCalls: z.object({ today: z.number().int().min(0), limit: z.number().int().min(1) }),
})
export type AdminStatsResponse = z.infer<typeof adminStatsResponseSchema>

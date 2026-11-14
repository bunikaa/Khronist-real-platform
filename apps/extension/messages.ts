import { shelfmarkSchema } from '@khronist/contracts'
import { z } from 'zod'

export const pageRequestSchema = z.object({ type: z.literal('get-page') })

export const pageMessageSchema = z.object({
  type: z.literal('page'),
  shelfmark: shelfmarkSchema.nullable(),
})
export type PageMessage = z.infer<typeof pageMessageSchema>

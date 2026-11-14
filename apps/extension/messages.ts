import { boxSchema, createRecognitionRequestSchema, shelfmarkSchema } from '@khronist/contracts'
import { z } from 'zod'

export const pageRequestSchema = z.object({ type: z.literal('get-page') })

export const pageMessageSchema = z.object({
  type: z.literal('page'),
  shelfmark: shelfmarkSchema.nullable(),
  selecting: z.boolean(),
})
export type PageMessage = z.infer<typeof pageMessageSchema>

export const selectionCommandSchema = z.object({
  type: z.enum(['start-selection', 'cancel-selection']),
})
export type SelectionCommand = z.infer<typeof selectionCommandSchema>

export const fragmentSchema = z.object({
  base64Png: createRecognitionRequestSchema.shape.image.shape.base64Png,
  imageHash: createRecognitionRequestSchema.shape.imageHash,
  box: boxSchema,
  width: z.number().int().min(1),
  height: z.number().int().min(1),
})
export type Fragment = z.infer<typeof fragmentSchema>

export const fragmentMessageSchema = z.object({
  type: z.literal('fragment'),
  fragment: fragmentSchema,
})
export type FragmentMessage = z.infer<typeof fragmentMessageSchema>

import { boxSchema, createRecognitionRequestSchema, shelfmarkSchema } from '@khronist/contracts'
import { z } from 'zod'

export const pageRequestSchema = z.object({ type: z.literal('get-page') })

export const pageMessageSchema = z.object({
  type: z.literal('page'),
  shelfmark: shelfmarkSchema.nullable(),
  scan: z.boolean(),
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
  scaledFrom: z
    .object({ width: z.number().int().min(1), height: z.number().int().min(1) })
    .optional(),
})
export type Fragment = z.infer<typeof fragmentSchema>

export const fragmentMessageSchema = z.object({
  type: z.literal('fragment'),
  fragment: fragmentSchema,
  shelfmark: shelfmarkSchema.nullable(),
})
export type FragmentMessage = z.infer<typeof fragmentMessageSchema>

export const fragmentFailedMessageSchema = z.object({
  type: z.literal('fragment-failed'),
  reason: z.enum(['outside', 'not_loaded', 'crop']),
  shelfmark: shelfmarkSchema.nullable(),
})
export type FragmentFailedMessage = z.infer<typeof fragmentFailedMessageSchema>

import { z } from 'zod'
import { entitySchema } from './common.ts'

export const entitiesOutputSchema = z.object({
  entities: z.array(
    z.object({
      type: entitySchema.shape.type,
      text: z.string(),
      normalized: z.string(),
    }),
  ),
})
export type EntitiesOutput = z.infer<typeof entitiesOutputSchema>

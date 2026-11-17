import { z } from 'zod'

export const translateOutputSchema = z.object({
  lines: z.array(z.string()),
})
export type TranslateOutput = z.infer<typeof translateOutputSchema>

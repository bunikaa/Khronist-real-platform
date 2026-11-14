import { z } from 'zod'
import { htrVisionOutputSchema } from './htr.ts'

export const normalizeOutputSchema = z.object({
  lines: htrVisionOutputSchema.shape.lines,
  expansions: z.array(z.object({ from: z.string(), to: z.string() })),
})
export type NormalizeOutput = z.infer<typeof normalizeOutputSchema>

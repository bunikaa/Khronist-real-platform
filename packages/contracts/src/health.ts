import { z } from 'zod'

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(['ok', 'down']),
  llm: z.enum(['ok', 'degraded']),
  htr: z.enum(['vision', 'remote', 'fixture', 'down']),
})
export type HealthResponse = z.infer<typeof healthResponseSchema>

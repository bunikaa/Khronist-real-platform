import { healthResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { ProviderStatus } from '../config.ts'
import { runWithTimeout } from '../lib/timeout.ts'

export type HealthDeps = {
  checkDb: () => Promise<boolean>
  providers: ProviderStatus
  dbTimeoutMs?: number
}

export const healthRoutes =
  (deps: HealthDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/health',
      { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
      async (_request, reply) => {
        const dbUp = await runWithTimeout(deps.checkDb, deps.dbTimeoutMs ?? 2000, 'database check').catch(
          () => false,
        )
        if (!dbUp) reply.code(503)
        return {
          ok: dbUp,
          db: dbUp ? ('ok' as const) : ('down' as const),
          llm: deps.providers.llm,
          htr: deps.providers.htr,
        }
      },
    )
  }

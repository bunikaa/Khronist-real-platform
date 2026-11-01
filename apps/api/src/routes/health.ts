import { healthResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { ProviderStatus } from '../config.ts'

export type HealthDeps = {
  checkDb: () => Promise<boolean>
  providers: ProviderStatus
  dbTimeoutMs?: number
}

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })

export const healthRoutes =
  (deps: HealthDeps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/health',
      { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
      async (_request, reply) => {
        const dbUp = await withTimeout(deps.checkDb(), deps.dbTimeoutMs ?? 2000).then(
          (ok) => ok,
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

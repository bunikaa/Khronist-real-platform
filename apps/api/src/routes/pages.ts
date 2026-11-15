import { pageLookupQuerySchema, pageLookupResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '../db/client.ts'
import { recordReadsPerMinute } from '../lib/limits.ts'
import { lookupPage } from '../services/pages.ts'

export const pageRoutes =
  (db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/v1/pages/lookup',
      {
        onRequest: app.rateLimit({ max: recordReadsPerMinute, timeWindow: '1 minute' }),
        schema: { querystring: pageLookupQuerySchema, response: { 200: pageLookupResponseSchema } },
      },
      async (request) => lookupPage(db, request.query),
    )
  }

import { searchQuerySchema, searchResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '../db/client.ts'
import { searchesPerMinute } from '../lib/limits.ts'
import { searchCommons } from '../services/search.ts'

export const searchRoutes =
  (db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/v1/search',
      {
        onRequest: app.rateLimit({ max: searchesPerMinute, timeWindow: '1 minute' }),
        schema: { querystring: searchQuerySchema, response: { 200: searchResponseSchema } },
      },
      async (request) => searchCommons(db, request.query),
    )
  }

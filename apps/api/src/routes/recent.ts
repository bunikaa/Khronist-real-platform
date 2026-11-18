import { recentQuerySchema, recentResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '../db/client.ts'
import { searchesPerMinute } from '../lib/limits.ts'
import { recentRecords } from '../services/recent.ts'

export const recentRoutes =
  (db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/v1/transcriptions/recent',
      {
        onRequest: app.rateLimit({ max: searchesPerMinute, timeWindow: '1 minute' }),
        schema: { querystring: recentQuerySchema, response: { 200: recentResponseSchema } },
      },
      async (request) => recentRecords(db, request.query),
    )
  }

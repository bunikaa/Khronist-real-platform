import {
  adminChunksRequestSchema,
  adminChunksResponseSchema,
  adminSourcesRequestSchema,
  adminSourcesResponseSchema,
  adminStatsResponseSchema,
  adminSynonymsRequestSchema,
  adminSynonymsResponseSchema,
} from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { createHash, timingSafeEqual } from 'node:crypto'
import type { Database } from '../db/client.ts'
import { ApiError } from '../lib/errors.ts'
import { maxAdminBodyBytes } from '../lib/limits.ts'
import { syncChunks, upsertSources, upsertSynonyms } from '../services/corpus.ts'
import { adminStats } from '../services/stats.ts'

export type AdminDeps = {
  db: Database
  apiKey: string
  modelCallsPerDay: number
}

const digest = (value: string) => createHash('sha256').update(value).digest()

const bearerToken = (header: string | undefined) =>
  header?.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''

export const adminRoutes =
  (deps: AdminDeps): FastifyPluginAsyncZod =>
  async (app) => {
    const expected = digest(deps.apiKey)
    app.addHook('onRequest', async (request) => {
      if (!timingSafeEqual(digest(bearerToken(request.headers.authorization)), expected)) {
        throw new ApiError(401, 'unauthorized', 'Потрібен ключ адміністратора')
      }
    })

    app.post(
      '/v1/admin/sources',
      {
        bodyLimit: maxAdminBodyBytes,
        schema: { body: adminSourcesRequestSchema, response: { 200: adminSourcesResponseSchema } },
      },
      async (request) => upsertSources(deps.db, request.body),
    )

    app.post(
      '/v1/admin/chunks',
      {
        bodyLimit: maxAdminBodyBytes,
        schema: { body: adminChunksRequestSchema, response: { 200: adminChunksResponseSchema } },
      },
      async (request) => syncChunks(deps.db, request.body),
    )

    app.post(
      '/v1/admin/synonyms',
      {
        bodyLimit: maxAdminBodyBytes,
        schema: {
          body: adminSynonymsRequestSchema,
          response: { 200: adminSynonymsResponseSchema },
        },
      },
      async (request) => upsertSynonyms(deps.db, request.body),
    )

    app.get(
      '/v1/admin/stats',
      { schema: { response: { 200: adminStatsResponseSchema } } },
      async () => adminStats(deps.db, deps.modelCallsPerDay),
    )
  }

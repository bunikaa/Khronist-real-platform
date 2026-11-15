import { idParamsSchema, transcriptionSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '../db/client.ts'
import { ApiError } from '../lib/errors.ts'
import { recordReadsPerMinute } from '../lib/limits.ts'
import { loadTranscription } from '../services/transcriptions.ts'

export const transcriptionRoutes =
  (db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/v1/transcriptions/:id',
      {
        onRequest: app.rateLimit({ max: recordReadsPerMinute, timeWindow: '1 minute' }),
        schema: { params: idParamsSchema, response: { 200: transcriptionSchema } },
      },
      async (request) => {
        const transcription = await loadTranscription(db, request.params.id)
        if (!transcription) throw new ApiError(404, 'not_found', 'Транскрипцію не знайдено')
        return transcription
      },
    )
  }

import { citeRequestSchema, citeResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Database } from '../db/client.ts'
import { ApiError } from '../lib/errors.ts'
import { maxCiteBodyBytes, recordReadsPerMinute } from '../lib/limits.ts'
import { formatCitation } from '../services/citation.ts'
import { transcriptionNotFound } from '../services/edits.ts'
import { loadTranscription, preferredVersionId } from '../services/transcriptions.ts'

const withoutShelfmark = () =>
  new ApiError(404, 'not_found', 'У фрагмента немає шифру, тож цитату скласти не можна')

export const citeRoutes =
  (db: Database): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/v1/cite',
      {
        bodyLimit: maxCiteBodyBytes,
        onRequest: app.rateLimit({ max: recordReadsPerMinute, timeWindow: '1 minute' }),
        schema: { body: citeRequestSchema, response: { 200: citeResponseSchema } },
      },
      async (request) => {
        const { transcriptionId, format, withTranscription } = request.body
        const versionId = await preferredVersionId(db, transcriptionId)
        const transcription = versionId && (await loadTranscription(db, versionId))
        if (!transcription) throw transcriptionNotFound()
        if (!transcription.shelfmark) throw withoutShelfmark()
        const { shelfmark } = transcription
        return {
          text: formatCitation({
            shelfmark,
            transcription,
            format,
            withTranscription,
            accessedAt: new Date(),
          }),
        }
      },
    )
  }

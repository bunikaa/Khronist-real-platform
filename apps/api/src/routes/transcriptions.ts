import {
  idParamsSchema,
  patchLinesRequestSchema,
  transcriptionHistorySchema,
  transcriptionSchema,
  verifyRequestSchema,
  versionConflictSchema,
} from '@khronist/contracts'
import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Auth } from '../auth/index.ts'
import { requireSession, signedInUser, verifierCheck } from '../auth/session.ts'
import type { Database } from '../db/client.ts'
import type { Renormalizer } from '../jobs/renormalize.ts'
import { ApiError } from '../lib/errors.ts'
import { maxEditBodyBytes, recordEditsPerMinute, recordReadsPerMinute } from '../lib/limits.ts'
import { editLines, loadHistory, transcriptionNotFound, verifyVersion } from '../services/edits.ts'
import { loadTranscription } from '../services/transcriptions.ts'

type EditingDeps = {
  auth: Auth
  verifierEmails: string[]
  renormalizer: Renormalizer
}

export const transcriptionRoutes =
  (db: Database, editing: EditingDeps | undefined): FastifyPluginAsyncZod =>
  async (app) => {
    const perMinute = (max: number) => app.rateLimit({ max, timeWindow: '1 minute' })
    const loaded = async (transcriptionId: string) => {
      const transcription = await loadTranscription(db, transcriptionId)
      if (!transcription) throw transcriptionNotFound()
      return transcription
    }

    app.get(
      '/v1/transcriptions/:id',
      {
        onRequest: perMinute(recordReadsPerMinute),
        schema: { params: idParamsSchema, response: { 200: transcriptionSchema } },
      },
      async (request) => loaded(request.params.id),
    )

    app.get(
      '/v1/transcriptions/:id/history',
      {
        onRequest: perMinute(recordReadsPerMinute),
        schema: { params: idParamsSchema, response: { 200: transcriptionHistorySchema } },
      },
      async (request) => {
        const history = await loadHistory(db, request.params.id)
        if (!history) throw transcriptionNotFound()
        return history
      },
    )

    if (!editing) return
    const { auth, renormalizer } = editing
    const isVerifier = verifierCheck(editing.verifierEmails)
    const conflict = async (reply: FastifyReply, currentId: string) =>
      reply.status(409).send({
        error: {
          code: 'version_conflict',
          message: 'Транскрипцію вже змінили, ось поточна версія',
        },
        current: await loaded(currentId),
      })

    app.decorateRequest('sessionUser', null)
    app.addHook('onClose', async () => renormalizer.stop())

    app.patch(
      '/v1/transcriptions/:id/lines',
      {
        bodyLimit: maxEditBodyBytes,
        onRequest: [perMinute(recordEditsPerMinute), requireSession(auth)],
        schema: {
          params: idParamsSchema,
          body: patchLinesRequestSchema,
          response: { 200: transcriptionSchema, 409: versionConflictSchema },
        },
      },
      async (request, reply) => {
        const outcome = await editLines(
          db,
          request.params.id,
          request.body,
          signedInUser(request).id,
        )
        if (outcome.kind === 'conflict') return conflict(reply, outcome.currentId)
        if (outcome.kind === 'edited') renormalizer.schedule(outcome.transcriptionId)
        return loaded(outcome.transcriptionId)
      },
    )

    app.post(
      '/v1/transcriptions/:id/verify',
      {
        onRequest: [perMinute(recordEditsPerMinute), requireSession(auth)],
        schema: {
          params: idParamsSchema,
          body: verifyRequestSchema,
          response: { 200: transcriptionSchema, 409: versionConflictSchema },
        },
      },
      async (request, reply) => {
        const user = signedInUser(request)
        if (!isVerifier(user.email)) {
          throw new ApiError(
            403,
            'forbidden',
            'Підтверджувати можуть лише команда й історик проєкту',
          )
        }
        const outcome = await verifyVersion(db, request.params.id, user.id, request.body.signature)
        if (outcome.kind === 'conflict') return conflict(reply, outcome.currentId)
        return loaded(outcome.transcriptionId)
      },
    )
  }

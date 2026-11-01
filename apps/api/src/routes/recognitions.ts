import {
  createRecognitionRequestSchema,
  createRecognitionResponseSchema,
  recognitionFailureCodeSchema,
  recognitionStateSchema,
  type RecognitionEvent,
} from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { failureMessages } from '../jobs/recognize.ts'
import { ApiError } from '../lib/errors.ts'
import { maxBodyBytes } from '../lib/limits.ts'
import {
  createRecognition,
  findRecognition,
  getRecognitionState,
  loadTranscription,
  type RecognitionDeps,
} from '../services/recognitions.ts'

const idParams = z.object({ id: z.uuid() })

const maxPendingBytes = 1024 * 1024

const encode = (event: RecognitionEvent): string =>
  `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

export const recognitionRoutes =
  (deps: RecognitionDeps): FastifyPluginAsyncZod =>
  async (app) => {
    const openStreams = new Set<() => void>()
    app.addHook('preClose', async () => {
      for (const close of [...openStreams]) close()
    })

    app.post(
      '/v1/recognitions',
      {
        bodyLimit: maxBodyBytes,
        schema: {
          body: createRecognitionRequestSchema,
          response: { 201: createRecognitionResponseSchema },
        },
      },
      async (request, reply) => reply.code(201).send(await createRecognition(deps, request.body)),
    )

    app.get(
      '/v1/recognitions/:id',
      { schema: { params: idParams, response: { 200: recognitionStateSchema } } },
      async (request) => {
        const state = await getRecognitionState(deps.db, request.params.id)
        if (!state) throw new ApiError(404, 'not_found', 'Розпізнавання не знайдено')
        return state
      },
    )

    app.get('/v1/recognitions/:id/events', { schema: { params: idParams } }, async (request, reply) => {
      const { id } = request.params
      const record = await findRecognition(deps.db, id)
      if (!record) throw new ApiError(404, 'not_found', 'Розпізнавання не знайдено')

      reply.hijack()
      const raw = reply.raw
      if (raw.destroyed || request.raw.destroyed) return

      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) raw.setHeader(name, value)
      }
      raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'close',
        'x-accel-buffering': 'no',
      })
      raw.write('retry: 3000\n\n')

      let closed = false
      let unsubscribe: (() => void) | undefined

      const finish = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        clearTimeout(lifetime)
        openStreams.delete(finish)
        unsubscribe?.()
        raw.end()
      }
      const heartbeat = setInterval(() => {
        if (closed) return
        if (raw.writableLength > maxPendingBytes) {
          raw.destroy()
          finish()
          return
        }
        raw.write(': ping\n\n')
      }, deps.heartbeatMs ?? 15_000)
      heartbeat.unref()
      const lifetime = setTimeout(finish, deps.maxStreamMs ?? 5 * 60_000)
      lifetime.unref()

      openStreams.add(finish)
      raw.once('close', finish)
      request.raw.once('close', finish)

      const send = (event: RecognitionEvent) => {
        if (closed) return
        raw.write(encode(event))
        if (event.event === 'done' || event.event === 'failed') finish()
      }

      try {
        const finished = record.status === 'done' || record.status === 'failed'
        if (!finished || deps.hub.hasHistory(id)) {
          const stop = deps.hub.subscribe(id, send)
          unsubscribe = stop
          if (closed) stop()
          return
        }

        if (record.status === 'failed') {
          const parsed = recognitionFailureCodeSchema.safeParse(record.errorCode)
          const code = parsed.success ? parsed.data : 'read_failed'
          send({ event: 'failed', data: { code, message: record.errorMessage ?? failureMessages[code] } })
          return
        }

        const transcription = record.transcriptionId
          ? await loadTranscription(deps.db, record.transcriptionId)
          : undefined
        if (!transcription) {
          send({ event: 'failed', data: { code: 'save_failed', message: failureMessages.save_failed } })
          return
        }
        for (const line of transcription.lines) send({ event: 'line', data: { line } })
        send({ event: 'done', data: { transcriptionId: transcription.id } })
      } catch (error) {
        request.log.error(error)
        send({ event: 'failed', data: { code: 'save_failed', message: failureMessages.save_failed } })
        finish()
      }
    })
  }

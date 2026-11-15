import {
  createRecognitionRequestSchema,
  createRecognitionResponseSchema,
  recognitionStateSchema,
  type RecognitionEvent,
} from '@khronist/contracts'
import type { FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { failureEvent } from '../jobs/recognize.ts'
import { ApiError } from '../lib/errors.ts'
import {
  guestRecognitionsPerMinute,
  maxBodyBytes,
  maxOpenStreams,
  recognitionReadsPerMinute,
  streamRetryAfterSeconds,
  streamsPerClient,
} from '../lib/limits.ts'
import {
  createRecognition,
  findRecognition,
  getRecognitionState,
  replayEvents,
  type RecognitionDeps,
} from '../services/recognitions.ts'

const idParams = z.object({ id: z.uuid() })

const maxPendingBytes = 1024 * 1024
const secondsPerDay = 24 * 60 * 60

const encode = (event: RecognitionEvent): string =>
  `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`

export type RecognitionRouteOptions = {
  guestPerDay: number
  clientKey: (request: FastifyRequest) => string
}

export const recognitionRoutes =
  (deps: RecognitionDeps, options: RecognitionRouteOptions): FastifyPluginAsyncZod =>
  async (app) => {
    const openStreams = new Set<() => void>()
    const streamsByClient = new Map<string, number>()
    app.addHook('preClose', async () => {
      for (const close of [...openStreams]) close()
    })

    const dailyReads = app.createRateLimit({ max: options.guestPerDay, timeWindow: '1 day' })
    const readsPerMinute = app.rateLimit({
      max: recognitionReadsPerMinute,
      timeWindow: '1 minute',
    })

    app.post(
      '/v1/recognitions',
      {
        bodyLimit: maxBodyBytes,
        config: {
          rateLimit: {
            max: guestRecognitionsPerMinute,
            timeWindow: '1 minute',
            errorResponseBuilder: () =>
              new ApiError(429, 'too_many_requests', 'Забагато запитів, спробуйте за хвилину'),
          },
        },
        schema: {
          body: createRecognitionRequestSchema,
          response: { 201: createRecognitionResponseSchema },
        },
      },
      async (request, reply) => {
        const created = await createRecognition(deps, request.body, {
          key: options.clientKey(request),
          consumeDailyRead: async () => {
            const limit = await dailyReads(request)
            return limit.isAllowed
              ? { allowed: true, retryAfterSeconds: 0 }
              : {
                  allowed: !limit.isExceeded,
                  retryAfterSeconds: limit.ttlInSeconds || secondsPerDay,
                }
          },
        })
        request.log.info(
          { recognitionId: created.recognitionId, status: created.status },
          'recognition accepted',
        )
        return reply.code(201).send(created)
      },
    )

    app.get(
      '/v1/recognitions/:id',
      {
        onRequest: readsPerMinute,
        schema: { params: idParams, response: { 200: recognitionStateSchema } },
      },
      async (request) => {
        const state = await getRecognitionState(deps.db, request.params.id)
        if (!state) throw new ApiError(404, 'not_found', 'Розпізнавання не знайдено')
        return state
      },
    )

    app.get(
      '/v1/recognitions/:id/events',
      { onRequest: readsPerMinute, schema: { params: idParams } },
      async (request, reply) => {
        const { id } = request.params
        const record = await findRecognition(deps.db, id)
        if (!record) throw new ApiError(404, 'not_found', 'Розпізнавання не знайдено')

        const client = options.clientKey(request)
        const ownStreams = streamsByClient.get(client) ?? 0
        if (openStreams.size >= maxOpenStreams || ownStreams >= streamsPerClient) {
          throw new ApiError(
            429,
            'too_many_requests',
            'Забагато відкритих потоків, спробуйте пізніше',
            streamRetryAfterSeconds,
          )
        }

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
          const left = (streamsByClient.get(client) ?? 1) - 1
          if (left > 0) streamsByClient.set(client, left)
          else streamsByClient.delete(client)
          unsubscribe?.()
          raw.end()
        }
        const replayIfFinishedElsewhere = async () => {
          if (deps.hub.hasHistory(id)) return
          const current = await findRecognition(deps.db, id)
          if (current && (current.status === 'done' || current.status === 'failed')) {
            for (const event of await replayEvents(deps.db, current)) send(event)
          }
        }
        const heartbeat = setInterval(() => {
          if (closed) return
          if (raw.writableLength > maxPendingBytes) {
            raw.destroy()
            finish()
            return
          }
          raw.write(': ping\n\n')
          replayIfFinishedElsewhere().catch((error: unknown) => request.log.error(error))
        }, deps.heartbeatMs ?? 15_000)
        heartbeat.unref()
        const lifetime = setTimeout(finish, deps.maxStreamMs ?? 5 * 60_000)
        lifetime.unref()

        openStreams.add(finish)
        streamsByClient.set(client, ownStreams + 1)
        raw.once('close', finish)
        request.raw.once('close', finish)

        const send = (event: RecognitionEvent) => {
          if (closed) return
          raw.write(encode(event))
          if (event.event === 'done' || event.event === 'failed') finish()
        }

        try {
          const hasHistory = deps.hub.hasHistory(id)
          const finished = record.status === 'done' || record.status === 'failed'
          if (finished && !hasHistory) {
            for (const event of await replayEvents(deps.db, record)) send(event)
            return
          }
          if (!hasHistory) send({ event: 'progress', data: { status: record.status } })
          const stop = deps.hub.subscribe(id, send)
          unsubscribe = stop
          if (closed) stop()
        } catch (error) {
          request.log.error(error)
          send(failureEvent('save_failed'))
          finish()
        }
      },
    )
  }

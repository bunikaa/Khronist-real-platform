import { chatRequestSchema, chatResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApiError } from '../lib/errors.ts'
import { chatsPerMinute, guestChatsPerDay, maxChatBodyBytes } from '../lib/limits.ts'
import type { ChatResponder } from '../services/chat.ts'

const secondsPerDay = 24 * 60 * 60

export const chatRoutes =
  (chat: ChatResponder, perDayLimit = guestChatsPerDay): FastifyPluginAsyncZod =>
  async (app) => {
    const perMinute = app.rateLimit({
      max: chatsPerMinute,
      timeWindow: '1 minute',
      errorResponseBuilder: () =>
        new ApiError(429, 'too_many_requests', 'Забагато запитів, спробуйте за хвилину'),
    })
    const perDay = app.createRateLimit({ max: perDayLimit, timeWindow: '1 day' })

    app.post(
      '/v1/chat',
      {
        bodyLimit: maxChatBodyBytes,
        onRequest: perMinute,
        schema: { body: chatRequestSchema, response: { 200: chatResponseSchema } },
      },
      async (request) => {
        const daily = await perDay(request)
        if (!daily.isAllowed && daily.isExceeded) {
          throw new ApiError(
            429,
            'too_many_requests',
            'Денний ліміт запитань чату вичерпано, спробуйте завтра',
            daily.ttlInSeconds || secondsPerDay,
          )
        }
        return chat(request.body, request.log)
      },
    )
  }

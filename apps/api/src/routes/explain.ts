import { explainRequestSchema, explainResponseSchema } from '@khronist/contracts'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { ApiError } from '../lib/errors.ts'
import { explainsPerMinute, guestExplainsPerDay, maxExplainBodyBytes } from '../lib/limits.ts'
import type { Explainer } from '../services/explain.ts'

const secondsPerDay = 24 * 60 * 60

export const explainRoutes =
  (explain: Explainer, perDayLimit = guestExplainsPerDay): FastifyPluginAsyncZod =>
  async (app) => {
    const perMinute = app.rateLimit({
      max: explainsPerMinute,
      timeWindow: '1 minute',
      errorResponseBuilder: () =>
        new ApiError(429, 'too_many_requests', 'Забагато запитів, спробуйте за хвилину'),
    })
    const perDay = app.createRateLimit({ max: perDayLimit, timeWindow: '1 day' })

    app.post(
      '/v1/explain',
      {
        bodyLimit: maxExplainBodyBytes,
        onRequest: perMinute,
        schema: { body: explainRequestSchema, response: { 200: explainResponseSchema } },
      },
      async (request) => {
        const daily = await perDay(request)
        if (!daily.isAllowed && daily.isExceeded) {
          throw new ApiError(
            429,
            'too_many_requests',
            'Денний ліміт пояснень вичерпано, спробуйте завтра',
            daily.ttlInSeconds || secondsPerDay,
          )
        }
        return explain(request.body, request.log)
      },
    )
  }

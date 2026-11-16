import {
  signInCodeRequestSchema,
  signInRequestSchema,
  updateUserRequestSchema,
} from '@khronist/contracts'
import { fromNodeHeaders } from 'better-auth/node'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import type { CodeLimits } from '../auth/codes.ts'
import type { Auth } from '../auth/index.ts'
import { ApiError } from '../lib/errors.ts'

const exposeHeaders = 'access-control-expose-headers'
const defaultRetryAfterSeconds = 60

const authErrorSchema = z.object({ code: z.string().regex(/^[A-Z][A-Z0-9_]*$/) })

const authErrorMessages: Record<string, string> = {
  INVALID_OTP: 'Невірний код',
  OTP_EXPIRED: 'Код прострочено, запросіть новий',
  TOO_MANY_ATTEMPTS: 'Забагато спроб, запросіть новий код',
  INVALID_ORIGIN: 'Запит із недовіреного джерела',
}

const badRequest = { code: 'bad_request', message: 'Некоректний запит' }

const statusErrors: Record<number, { code: string; message: string }> = {
  400: badRequest,
  401: { code: 'unauthorized', message: 'Потрібен вхід' },
  403: { code: 'forbidden', message: 'Доступ заборонено' },
  404: { code: 'not_found', message: 'Не знайдено' },
}

const mergedList = (current: unknown, added: string): string =>
  [
    ...new Set(
      [typeof current === 'string' ? current : '', added]
        .flatMap((list) => list.split(','))
        .map((name) => name.trim())
        .filter(Boolean),
    ),
  ].join(', ')

const errorOf = async (response: Response): Promise<ApiError> => {
  if (response.status === 429) {
    return new ApiError(
      429,
      'too_many_requests',
      'Забагато спроб, спробуйте за хвилину',
      Number(response.headers.get('x-retry-after')) || defaultRetryAfterSeconds,
    )
  }
  if (response.status >= 500) {
    return new ApiError(500, 'internal_error', 'Внутрішня помилка сервера')
  }
  const parsed = authErrorSchema.safeParse(await response.json().catch(() => undefined))
  const known = parsed.success ? authErrorMessages[parsed.data.code] : undefined
  if (parsed.success && known !== undefined) {
    return new ApiError(response.status, parsed.data.code.toLowerCase(), known)
  }
  const fallback = statusErrors[response.status] ?? badRequest
  return new ApiError(response.status, fallback.code, fallback.message)
}

export const authRoutes =
  (
    auth: Auth,
    baseURL: string,
    limits: CodeLimits,
    clientKey: (request: FastifyRequest) => string,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    const forward = async (request: FastifyRequest, reply: FastifyReply) => {
      const response = await auth.handler(
        new Request(new URL(request.url, baseURL), {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          ...(request.body !== undefined && { body: JSON.stringify(request.body) }),
        }),
      )
      if (response.status >= 400) throw await errorOf(response)
      reply.status(response.status)
      response.headers.forEach((value, name) => {
        reply.header(
          name,
          name === exposeHeaders ? mergedList(reply.getHeader(name), value) : value,
        )
      })
      return reply.send(await response.text())
    }

    app.post(
      '/api/auth/email-otp/send-verification-otp',
      { schema: { body: signInCodeRequestSchema } },
      async (request, reply) => {
        const reserved = limits.reserve(request.body.email, clientKey(request))
        if (!reserved.ok) {
          throw new ApiError(
            429,
            'too_many_requests',
            reserved.reason === 'day'
              ? 'Денний ліміт листів із кодом вичерпано, спробуйте завтра'
              : 'Забагато кодів на цю адресу, спробуйте за 15 хвилин',
            reserved.retryAfterSeconds,
          )
        }
        let sent = false
        try {
          const answer = await forward(request, reply)
          sent = reply.statusCode === 200
          return answer
        } finally {
          if (!sent) reserved.release()
        }
      },
    )
    app.post('/api/auth/sign-in/email-otp', { schema: { body: signInRequestSchema } }, forward)
    app.get('/api/auth/get-session', forward)
    app.post('/api/auth/sign-out', forward)
    app.post('/api/auth/update-user', { schema: { body: updateUserRequestSchema } }, forward)
  }

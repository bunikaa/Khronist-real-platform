import cors from '@fastify/cors'
import rateLimit, { normalizeIP } from '@fastify/rate-limit'
import Fastify, { type FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { createAuth, type AuthOptions } from './auth/index.ts'
import { ApiError } from './lib/errors.ts'
import { defaultGuestRecognitionsPerDay } from './lib/limits.ts'
import { authRoutes } from './routes/auth.ts'
import { healthRoutes, type HealthDeps } from './routes/health.ts'
import { pageRoutes } from './routes/pages.ts'
import { recognitionRoutes } from './routes/recognitions.ts'
import { transcriptionRoutes } from './routes/transcriptions.ts'
import type { RecognitionDeps } from './services/recognitions.ts'

export type AppDeps = HealthDeps & {
  logLevel?: string
  clientIpHeader?: string
  corsOrigins?: string[]
  guestRecognitionsPerDay?: number
  isShuttingDown?: () => boolean
  recognitions?: Omit<RecognitionDeps, 'log'>
  auth?: Pick<AuthOptions, 'db' | 'secret' | 'baseURL' | 'sendCode'>
}

const shuttingDown = {
  code: 'shutting_down',
  message: 'Сервер перезапускається, спробуйте за кілька секунд',
}
const shutdownRetryAfterSeconds = 5

type ErrorDescription = { code: string; message: string }

const clientErrors: Record<number, ErrorDescription> = {
  400: { code: 'bad_request', message: 'Некоректний запит' },
  401: { code: 'unauthorized', message: 'Потрібен вхід' },
  403: { code: 'forbidden', message: 'Доступ заборонено' },
  404: { code: 'not_found', message: 'Не знайдено' },
  409: { code: 'conflict', message: 'Конфлікт версій' },
  413: { code: 'too_large', message: 'Запит завеликий' },
  429: { code: 'too_many_requests', message: 'Забагато запитів, спробуйте пізніше' },
}

const serverError: ErrorDescription = {
  code: 'internal_error',
  message: 'Внутрішня помилка сервера',
}

const statusOf = (error: unknown): number =>
  error instanceof Error &&
  'statusCode' in error &&
  typeof error.statusCode === 'number' &&
  error.statusCode >= 400
    ? error.statusCode
    : 500

const describe = (error: unknown, status: number): ErrorDescription => {
  if (error instanceof ApiError) return { code: error.code, message: error.message }
  if (status >= 500) return serverError
  return clientErrors[status] ?? { code: 'bad_request', message: 'Некоректний запит' }
}

const clientAddress = (request: FastifyRequest, header: string | undefined): string => {
  const value = header === undefined ? undefined : request.headers[header]
  return typeof value === 'string' && isIP(value) !== 0 ? value : request.ip
}

export const buildApp = async (deps: AppDeps) => {
  const app = Fastify({
    logger: { level: deps.logLevel ?? 'info' },
    requestIdHeader: 'x-railway-request-id',
    genReqId: () => randomUUID(),
    return503OnClosing: false,
  }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error)
    if (status >= 500) request.log.error(error)
    else request.log.warn({ err: error, status }, 'request rejected')
    if (error instanceof ApiError && error.retryAfterSeconds !== undefined) {
      reply.header('retry-after', String(error.retryAfterSeconds))
    }
    if (status === 429 && !reply.hasHeader('retry-after')) reply.header('retry-after', '60')
    return reply.status(status).send({ error: describe(error, status) })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: describe(undefined, 404) }),
  )

  await app.register(cors, {
    origin: deps.corsOrigins ?? false,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['content-type', 'authorization'],
    exposedHeaders: [
      'retry-after',
      'x-request-id',
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  })
  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id)
    if (!deps.isShuttingDown?.()) return
    reply.header('retry-after', String(shutdownRetryAfterSeconds))
    return reply.status(503).send({ error: shuttingDown })
  })

  const clientKey = (request: FastifyRequest) =>
    normalizeIP(clientAddress(request, deps.clientIpHeader))
  await app.register(rateLimit, { global: false, keyGenerator: clientKey })

  await app.register(healthRoutes(deps))
  if (deps.auth) {
    const auth = createAuth({
      ...deps.auth,
      trustedOrigins: deps.corsOrigins ?? [],
      clientIpHeader: deps.clientIpHeader,
      log: app.log,
    })
    await app.register(authRoutes(auth, deps.auth.baseURL))
  }
  if (deps.recognitions) {
    await app.register(
      recognitionRoutes(
        { ...deps.recognitions, log: app.log },
        {
          guestPerDay: deps.guestRecognitionsPerDay ?? defaultGuestRecognitionsPerDay,
          clientKey,
        },
      ),
    )
    await app.register(transcriptionRoutes(deps.recognitions.db))
    await app.register(pageRoutes(deps.recognitions.db))
  }
  return app
}

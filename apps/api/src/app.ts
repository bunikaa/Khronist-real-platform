import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { ApiError } from './lib/errors.ts'
import { defaultGuestRecognitionsPerDay } from './lib/limits.ts'
import { healthRoutes, type HealthDeps } from './routes/health.ts'
import { recognitionRoutes } from './routes/recognitions.ts'
import type { RecognitionDeps } from './services/recognitions.ts'

export type AppDeps = HealthDeps & {
  logLevel?: string
  trustProxyHops?: number
  corsOrigins?: string[]
  guestRecognitionsPerDay?: number
  recognitions?: Omit<RecognitionDeps, 'log'>
}

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

export const buildApp = async (deps: AppDeps) => {
  const app = Fastify({
    trustProxy: (_address, hop) => hop < (deps.trustProxyHops ?? 0),
    logger: { level: deps.logLevel ?? 'info' },
  }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error)
    if (status >= 500) request.log.error(error)
    else request.log.warn({ err: error, status }, 'request rejected')
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
      'x-ratelimit-limit',
      'x-ratelimit-remaining',
      'x-ratelimit-reset',
    ],
  })
  await app.register(rateLimit, { global: false })

  await app.register(healthRoutes(deps))
  if (deps.recognitions) {
    await app.register(
      recognitionRoutes(
        { ...deps.recognitions, log: app.log },
        deps.guestRecognitionsPerDay ?? defaultGuestRecognitionsPerDay,
      ),
    )
  }
  return app
}

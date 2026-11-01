import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod'
import { healthRoutes, type HealthDeps } from './routes/health.ts'

export type AppDeps = HealthDeps & {
  logLevel?: string
}

export const maxBodyBytes = 12 * 1024 * 1024

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

const describe = (status: number): ErrorDescription => {
  if (status >= 500) return serverError
  return clientErrors[status] ?? { code: 'bad_request', message: 'Некоректний запит' }
}

export const buildApp = async (deps: AppDeps) => {
  const app = Fastify({
    bodyLimit: maxBodyBytes,
    logger: { level: deps.logLevel ?? 'info' },
  }).withTypeProvider<ZodTypeProvider>()
  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.setErrorHandler((error, request, reply) => {
    const status = statusOf(error)
    if (status >= 500) request.log.error(error)
    else request.log.warn({ err: error, status }, 'request rejected')
    return reply.status(status).send({ error: describe(status) })
  })

  app.setNotFoundHandler((_request, reply) =>
    reply.status(404).send({ error: describe(404) }),
  )

  await app.register(healthRoutes(deps))
  return app
}

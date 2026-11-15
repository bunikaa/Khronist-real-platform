import type { FastifyServerOptions } from 'fastify'
import { findPgViolation } from './errors.ts'

type SafeError = {
  [key: string]: unknown
  type: string
  message: string
  stack: string
}

type LoggerOptions = Exclude<NonNullable<FastifyServerOptions['logger']>, boolean>
type LogMethod = NonNullable<NonNullable<LoggerOptions['hooks']>['logMethod']>

const maxCauseDepth = 3

const withoutQueryValues = (message: string): string => message.split('\nparams:')[0] ?? ''

const framesOf = (error: Error): string =>
  (error.stack ?? '')
    .split('\n')
    .slice(error.message.split('\n').length)
    .filter((line) => line.trimStart().startsWith('at '))
    .join('\n')

const ownPgCode = (error: Error): string | undefined =>
  'code' in error && typeof error.code === 'string' && /^[0-9A-Z]{5}$/.test(error.code)
    ? error.code
    : undefined

const describe = (error: Error, depth: number): SafeError => {
  const pgCode = ownPgCode(error)
  const constraint = pgCode !== undefined ? findPgViolation(error)?.constraint : undefined
  const code =
    pgCode ?? ('code' in error && typeof error.code === 'string' ? error.code : undefined)
  const message =
    pgCode !== undefined ? `PostgreSQL error ${pgCode}` : withoutQueryValues(error.message)
  return {
    type: error.name,
    message,
    stack: `${error.name}: ${message}\n${framesOf(error)}`,
    ...(code !== undefined && { code }),
    ...(constraint !== undefined && { constraint }),
    ...(error.cause instanceof Error &&
      depth < maxCauseDepth && { cause: describe(error.cause, depth + 1) }),
  }
}

export const safeError = (error: unknown): SafeError =>
  error instanceof Error
    ? describe(error, 0)
    : { type: typeof error, message: 'a non-error value was logged', stack: '' }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

export const logMethod: LogMethod = function (args, method) {
  const [first, second, ...rest] = args
  if (first instanceof Error) {
    method.apply(this, [
      { err: first },
      typeof second === 'string' ? second : first.name,
      ...(typeof second === 'string' ? rest : []),
    ])
    return
  }
  if (isRecord(first) && first['err'] !== undefined && typeof second !== 'string') {
    method.apply(this, [first, 'error'])
    return
  }
  method.apply(this, args)
}

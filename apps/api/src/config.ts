import type { HealthResponse } from '@khronist/contracts'
import { z } from 'zod'
import { defaultGuestRecognitionsPerDay, defaultModelCallsPerDay } from './lib/limits.ts'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)
const readerModel = z.string().regex(/^(claude|gemini)-/, 'expected a claude-* or gemini-* model')
const corsOrigins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(
    z.array(
      z
        .string()
        .regex(
          /^(https?|chrome-extension):\/\/[^/\s*]+$/,
          'expected an exact origin without a trailing slash',
        ),
    ),
  )

const databaseUrl = z.string().min(1)

type ProviderKeys = { ANTHROPIC_API_KEY?: string | undefined; GOOGLE_API_KEY?: string | undefined }

export const hasKeyFor = (keys: ProviderKeys, model: string): boolean =>
  (model.startsWith('gemini-') ? keys.GOOGLE_API_KEY : keys.ANTHROPIC_API_KEY) !== undefined

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    CLIENT_IP_HEADER: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .regex(/^[a-z0-9-]+$/, 'expected a lowercase header name')
        .optional(),
    ),
    CORS_ORIGINS: z.preprocess(emptyToUndefined, corsOrigins.default([])),
    GUEST_RECOGNITIONS_PER_DAY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).default(defaultGuestRecognitionsPerDay),
    ),
    MODEL_CALLS_PER_DAY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).default(defaultModelCallsPerDay),
    ),
    RAILWAY_DEPLOYMENT_DRAINING_SECONDS: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(0).optional(),
    ),
    DATABASE_URL: databaseUrl,
    JOBS_CONCURRENCY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).max(32).default(4),
    ),
    LLM_FIXTURES: z.preprocess(emptyToUndefined, z.stringbool().default(false)),
    ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    GOOGLE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    HTR_MODEL_PRIMARY: z.preprocess(emptyToUndefined, readerModel.default('claude-sonnet-5-5')),
    HTR_MODEL_FALLBACK: z.preprocess(emptyToUndefined, readerModel.optional()),
    HTR_EFFORT: z.preprocess(
      emptyToUndefined,
      z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
    ),
    HTR_URL: z.preprocess(emptyToUndefined, z.url().optional()),
    BETTER_AUTH_SECRET: z.preprocess(emptyToUndefined, z.string().min(32).optional()),
    BETTER_AUTH_URL: z.preprocess(emptyToUndefined, z.httpUrl().optional()),
    RESEND_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    MAIL_FROM: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  })
  .refine((config) => !(config.NODE_ENV === 'production' && config.LLM_FIXTURES), {
    message: 'LLM_FIXTURES must not be enabled in production',
    path: ['LLM_FIXTURES'],
  })
  .refine(
    (config) =>
      config.NODE_ENV !== 'production' ||
      config.LLM_FIXTURES ||
      hasKeyFor(config, config.HTR_MODEL_PRIMARY),
    { message: 'the primary model has no API key', path: ['HTR_MODEL_PRIMARY'] },
  )
  .refine(
    (config) =>
      config.HTR_MODEL_FALLBACK === undefined || hasKeyFor(config, config.HTR_MODEL_FALLBACK),
    { message: 'the fallback model has no API key', path: ['HTR_MODEL_FALLBACK'] },
  )
  .refine((config) => config.HTR_URL === undefined, {
    message: 'the remote reader is not implemented yet, leave HTR_URL empty',
    path: ['HTR_URL'],
  })
  .refine((config) => config.NODE_ENV !== 'production' || config.RESEND_API_KEY !== undefined, {
    message: 'sign-in needs RESEND_API_KEY in production',
    path: ['RESEND_API_KEY'],
  })
  .refine(
    (config) =>
      config.RESEND_API_KEY === undefined ||
      (config.BETTER_AUTH_SECRET !== undefined &&
        config.BETTER_AUTH_URL !== undefined &&
        config.MAIL_FROM !== undefined),
    {
      message: 'sign-in needs BETTER_AUTH_SECRET, BETTER_AUTH_URL and MAIL_FROM',
      path: ['RESEND_API_KEY'],
    },
  )

export type Config = z.infer<typeof configSchema>

export type SignInSettings = {
  secret: string
  baseURL: string
  resendApiKey: string
  mailFrom: string
}

export const signInSettings = (config: Config): SignInSettings | undefined =>
  config.RESEND_API_KEY !== undefined &&
  config.BETTER_AUTH_SECRET !== undefined &&
  config.BETTER_AUTH_URL !== undefined &&
  config.MAIL_FROM !== undefined
    ? {
        secret: config.BETTER_AUTH_SECRET,
        baseURL: config.BETTER_AUTH_URL,
        resendApiKey: config.RESEND_API_KEY,
        mailFrom: config.MAIL_FROM,
      }
    : undefined

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }
  return parsed.data
}

export const loadDatabaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const parsed = databaseUrl.safeParse(env['DATABASE_URL'])
  if (!parsed.success) throw new Error('Invalid configuration: DATABASE_URL is required')
  return parsed.data
}

export type ProviderStatus = Pick<HealthResponse, 'llm' | 'htr'>

export const llmStatus = (config: Config): ProviderStatus['llm'] =>
  hasKeyFor(config, config.HTR_MODEL_PRIMARY) ? 'ok' : 'degraded'

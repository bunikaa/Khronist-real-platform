import { z } from 'zod'
import { defaultGuestRecognitionsPerDay } from './lib/limits.ts'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)
const readerModel = z.string().regex(/^(claude|gemini)-/, 'expected a claude-* or gemini-* model')
const corsOrigins = z
  .string()
  .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
  .pipe(
    z.array(
      z.string().regex(/^(https?|chrome-extension):\/\/[^/\s*]+$/, 'expected an exact origin without a trailing slash'),
    ),
  )

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY_HOPS: z.preprocess(emptyToUndefined, z.coerce.number().int().min(0).max(5).default(0)),
    CORS_ORIGINS: z.preprocess(emptyToUndefined, corsOrigins.default([])),
    GUEST_RECOGNITIONS_PER_DAY: z.preprocess(
      emptyToUndefined,
      z.coerce.number().int().min(1).default(defaultGuestRecognitionsPerDay),
    ),
    DATABASE_URL: z.string().min(1),
    JOBS_CONCURRENCY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(32).default(4)),
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
  })
  .refine((config) => !(config.NODE_ENV === 'production' && config.LLM_FIXTURES), {
    message: 'LLM_FIXTURES must not be enabled in production',
    path: ['LLM_FIXTURES'],
  })
  .refine(
    (config) => {
      const model = config.HTR_MODEL_FALLBACK
      if (model === undefined) return true
      return model.startsWith('gemini-') ? config.GOOGLE_API_KEY !== undefined : config.ANTHROPIC_API_KEY !== undefined
    },
    { message: 'the fallback model has no API key', path: ['HTR_MODEL_FALLBACK'] },
  )

export type Config = z.infer<typeof configSchema>

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const parsed = configSchema.safeParse(env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration: ${problems}`)
  }
  return parsed.data
}

export type ProviderStatus = {
  llm: 'ok' | 'degraded'
  htr: 'vision' | 'remote' | 'fixture' | 'down'
}

export const llmStatus = (config: Config): ProviderStatus['llm'] =>
  config.ANTHROPIC_API_KEY !== undefined ? 'ok' : 'degraded'

import { z } from 'zod'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const configSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.preprocess(emptyToUndefined, z.stringbool().default(false)),
    DATABASE_URL: z.string().min(1),
    JOBS_CONCURRENCY: z.preprocess(emptyToUndefined, z.coerce.number().int().min(1).max(32).default(4)),
    LLM_FIXTURES: z.preprocess(emptyToUndefined, z.stringbool().default(false)),
    ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
    HTR_URL: z.preprocess(emptyToUndefined, z.url().optional()),
  })
  .refine((config) => !(config.NODE_ENV === 'production' && config.LLM_FIXTURES), {
    message: 'LLM_FIXTURES must not be enabled in production',
    path: ['LLM_FIXTURES'],
  })

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

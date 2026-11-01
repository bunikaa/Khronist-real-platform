import { z } from 'zod'

const emptyToUndefined = (value: unknown) => (value === '' ? undefined : value)

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1).optional()),
  HTR_URL: z.preprocess(emptyToUndefined, z.url().optional()),
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
  htr: 'vision' | 'remote' | 'down'
}

export const describeProviders = (config: Config): ProviderStatus => {
  const hasLlm = config.ANTHROPIC_API_KEY !== undefined
  return {
    llm: hasLlm ? 'ok' : 'degraded',
    htr: config.HTR_URL !== undefined ? 'remote' : hasLlm ? 'vision' : 'down',
  }
}

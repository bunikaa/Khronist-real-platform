import { z } from 'zod'

type LlmImage = { type: 'image'; mediaType: 'image/png'; base64: string }
type LlmText = { type: 'text'; text: string }

export type LlmLog = { warn: (details: object, message: string) => void }

export type LlmCallLog = LlmLog & { info: (details: object, message: string) => void }

export type LlmRequest<T> = {
  system: string
  content: Array<LlmImage | LlmText>
  schema: z.ZodType<T>
  maxTokens: number
  signal?: AbortSignal | undefined
  log?: LlmLog | undefined
}

export type LlmUsage = { inputTokens: number; outputTokens: number }

type LlmResult<T> = { value: T; model: string; usage: LlmUsage }

export type LlmProvider = {
  name: string
  complete: <T>(request: LlmRequest<T>) => Promise<LlmResult<T>>
}

export class LlmOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LlmOutputError'
  }
}

export class LlmLimitError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'LlmLimitError'
  }
}

const limitStatuses = new Set([402, 429])

export const asLimitError = (error: unknown): unknown =>
  error instanceof Error &&
  'status' in error &&
  typeof error.status === 'number' &&
  limitStatuses.has(error.status)
    ? new LlmLimitError(`the provider refused: ${error.status}`, { cause: error })
    : error

export const toJsonSchema = <T>(schema: z.ZodType<T>) => {
  const { $schema: _, ...rest } = z.toJSONSchema(schema, { io: 'output' })
  return rest
}

export const parseOutput = <T>(text: string, schema: z.ZodType<T>): T => {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new LlmOutputError('the model did not return JSON', { cause: error })
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success) {
    throw new LlmOutputError('the model output does not match the schema', { cause: parsed.error })
  }
  return parsed.data
}

const retryInvalidOutput = async <T>(
  provider: LlmProvider,
  request: LlmRequest<T>,
): Promise<LlmResult<T>> => {
  try {
    return await provider.complete(request)
  } catch (error) {
    if (!(error instanceof LlmOutputError) || request.signal?.aborted) throw error
    request.log?.warn({ provider: provider.name, err: error }, 'invalid model output, retrying')
    return provider.complete(request)
  }
}

export const withFallback = (
  primary: LlmProvider,
  fallback: LlmProvider | undefined,
  primaryLimitMs: number,
): LlmProvider => ({
  name: primary.name,
  complete: async (request) => {
    if (!fallback) return retryInvalidOutput(primary, request)
    const limit = new AbortController()
    const timer = setTimeout(
      () => limit.abort(new Error(`the primary model took longer than ${primaryLimitMs} ms`)),
      primaryLimitMs,
    )
    const signal = request.signal ? AbortSignal.any([request.signal, limit.signal]) : limit.signal
    try {
      return await retryInvalidOutput(primary, { ...request, signal })
    } catch (error) {
      if (request.signal?.aborted || error instanceof LlmLimitError) throw error
      request.log?.warn(
        { provider: primary.name, err: error },
        'primary model failed, using the fallback',
      )
      return retryInvalidOutput(fallback, request)
    } finally {
      clearTimeout(timer)
    }
  },
})

export type CallBudget = {
  spend: () => Promise<boolean>
  available: (share?: number) => Promise<boolean>
}

export const withCallBudget = (provider: LlmProvider, budget: CallBudget): LlmProvider => ({
  name: provider.name,
  complete: async (request) => {
    if (!(await budget.spend())) throw new LlmLimitError('the daily model call budget is spent')
    return provider.complete(request)
  },
})

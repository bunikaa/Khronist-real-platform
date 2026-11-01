import type { z } from 'zod'

export type LlmImage = { type: 'image'; mediaType: 'image/png'; base64: string }
export type LlmText = { type: 'text'; text: string }

export type LlmRequest<T> = {
  system: string
  content: Array<LlmImage | LlmText>
  schema: z.ZodType<T>
  maxTokens: number
  signal?: AbortSignal | undefined
}

export type LlmUsage = { inputTokens: number; outputTokens: number }

export type LlmResult<T> = { value: T; model: string; usage: LlmUsage }

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

export type LlmFailureLog = (details: { provider: string; err: unknown }, message: string) => void

const retryInvalidOutput = async <T>(
  provider: LlmProvider,
  request: LlmRequest<T>,
  onFailure: LlmFailureLog,
): Promise<LlmResult<T>> => {
  try {
    return await provider.complete(request)
  } catch (error) {
    if (!(error instanceof LlmOutputError) || request.signal?.aborted) throw error
    onFailure({ provider: provider.name, err: error }, 'invalid model output, retrying')
    return provider.complete(request)
  }
}

export const withFallback = (
  primary: LlmProvider,
  fallback: LlmProvider | undefined,
  onFailure: LlmFailureLog,
): LlmProvider => ({
  name: primary.name,
  complete: async (request) => {
    try {
      return await retryInvalidOutput(primary, request, onFailure)
    } catch (error) {
      if (!fallback || request.signal?.aborted) throw error
      onFailure({ provider: primary.name, err: error }, 'primary model failed, using the fallback')
      return retryInvalidOutput(fallback, request, onFailure)
    }
  },
})

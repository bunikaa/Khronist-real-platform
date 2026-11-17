import { createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import type { z } from 'zod'
import {
  createRecognitionResponseSchema,
  errorSchema,
  explainResponseSchema,
  recognitionStateSchema,
  type CreateRecognitionRequest,
  type ExplainRequest,
  type ExplainResponse,
  type Hints,
  type Shelfmark,
  type Transcription,
} from '@khronist/contracts'

export class ApiFailure extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(`${code}: ${message}`)
    this.status = status
    this.code = code
  }
}

export type TranscribeRequest = { imageBase64: string; shelfmark?: Shelfmark; hints?: Hints }

export type ApiClient = {
  transcribe: (request: TranscribeRequest) => Promise<Transcription>
  explain: (request: ExplainRequest) => Promise<ExplainResponse>
}

export type ApiClientOptions = {
  baseUrl: string
  apiKey?: string
  fetch?: typeof fetch
  pollIntervalMs?: number
  waitLimitMs?: number
}

export const createApiClient = (options: ApiClientOptions): ApiClient => {
  const fetchApi = options.fetch ?? fetch
  const pollIntervalMs = options.pollIntervalMs ?? 2000
  const waitLimitMs = options.waitLimitMs ?? 240_000

  const send = async <T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> => {
    const headers: Record<string, string> = {}
    if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`
    if (body !== undefined) headers['content-type'] = 'application/json'
    const response = await fetchApi(new URL(path, options.baseUrl), {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const payload: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const error = errorSchema.safeParse(payload)
      if (error.success) {
        throw new ApiFailure(response.status, error.data.error.code, error.data.error.message)
      }
      throw new ApiFailure(response.status, 'unknown', `API відповів ${response.status}`)
    }
    return schema.parse(payload)
  }

  return {
    transcribe: async ({ imageBase64, shelfmark, hints }) => {
      const request: CreateRecognitionRequest = {
        image: { base64Png: imageBase64 },
        imageHash: createHash('sha256').update(Buffer.from(imageBase64, 'base64')).digest('hex'),
        source: 'mcp',
        shelfmark,
        hints,
      }
      const created = await send('/v1/recognitions', createRecognitionResponseSchema, request)
      const deadline = Date.now() + waitLimitMs
      for (;;) {
        const state = await send(
          `/v1/recognitions/${created.recognitionId}`,
          recognitionStateSchema,
        )
        if (state.status === 'done' && state.transcription) return state.transcription
        if (state.status === 'failed') {
          throw new ApiFailure(
            200,
            state.error?.code ?? 'read_failed',
            state.error?.message ?? 'Читання не вдалося',
          )
        }
        if (Date.now() >= deadline) {
          throw new ApiFailure(504, 'timeout', 'Читання не завершилося вчасно')
        }
        await sleep(pollIntervalMs)
      }
    },
    explain: (request) => send('/v1/explain', explainResponseSchema, request),
  }
}

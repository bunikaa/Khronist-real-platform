import {
  createRecognitionResponseSchema,
  errorSchema,
  recognitionStateSchema,
  type CreateRecognitionRequest,
  type CreateRecognitionResponse,
  type RecognitionEvent,
  type RecognitionState,
} from '@khronist/contracts'
import { readEvents } from './events.ts'
import { apiOrigin } from './origin.ts'

export class ApiFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

const failureOf = async (response: Response): Promise<ApiFailure> => {
  const parsed = errorSchema.safeParse(await response.json().catch(() => null))
  return parsed.success
    ? new ApiFailure(parsed.data.error.code, parsed.data.error.message)
    : new ApiFailure('internal_error', 'Внутрішня помилка сервера')
}

const send = async (path: string, init: RequestInit): Promise<Response> => {
  const response = await fetch(`${apiOrigin}${path}`, init)
  if (!response.ok) throw await failureOf(response)
  return response
}

export const createRecognition = async (
  body: CreateRecognitionRequest,
  signal: AbortSignal,
): Promise<CreateRecognitionResponse> => {
  const response = await send('/v1/recognitions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  return createRecognitionResponseSchema.parse(await response.json())
}

export const getRecognition = async (
  recognitionId: string,
  signal: AbortSignal,
): Promise<RecognitionState> => {
  const response = await send(`/v1/recognitions/${recognitionId}`, { signal })
  return recognitionStateSchema.parse(await response.json())
}

export async function* recognitionEvents(
  recognitionId: string,
  signal: AbortSignal,
): AsyncGenerator<RecognitionEvent> {
  const response = await send(`/v1/recognitions/${recognitionId}/events`, {
    headers: { accept: 'text/event-stream' },
    signal,
  })
  if (response.body) yield* readEvents(response.body)
}

const isFinished = (state: RecognitionState) => state.status === 'done' || state.status === 'failed'

export const readRecognition = async (
  body: CreateRecognitionRequest,
  signal: AbortSignal,
  onEvent: (event: RecognitionEvent) => void,
): Promise<RecognitionState> => {
  const created = await createRecognition(body, signal)
  let state = await getRecognition(created.recognitionId, signal)
  while (!isFinished(state)) {
    for await (const event of recognitionEvents(created.recognitionId, signal)) onEvent(event)
    state = await getRecognition(created.recognitionId, signal)
  }
  return state
}

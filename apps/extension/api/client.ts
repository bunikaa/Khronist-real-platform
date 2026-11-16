import {
  createRecognitionResponseSchema,
  errorSchema,
  recognitionStateSchema,
  versionConflictSchema,
  type CreateRecognitionRequest,
  type CreateRecognitionResponse,
  type RecognitionEvent,
  type RecognitionState,
  type Transcription,
} from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { readEvents } from './events.ts'
import { apiOrigin } from './origin.ts'
import { clearToken, readToken } from './token.ts'

export class ApiFailure extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export class VersionConflictFailure extends ApiFailure {
  readonly current: Transcription

  constructor(message: string, current: Transcription) {
    super('version_conflict', message)
    this.current = current
  }
}

const failureOf = async (response: Response): Promise<ApiFailure> => {
  const body: unknown = await response.json().catch(() => null)
  const conflict = versionConflictSchema.safeParse(body)
  if (conflict.success)
    return new VersionConflictFailure(conflict.data.error.message, conflict.data.current)
  const parsed = errorSchema.safeParse(body)
  return parsed.success
    ? new ApiFailure(parsed.data.error.code, parsed.data.error.message)
    : new ApiFailure('internal_error', strings.read.badResponse)
}

export const send = async (path: string, init: RequestInit): Promise<Response> => {
  const token = await readToken()
  const headers = new Headers(init.headers)
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers })
  if (!response.ok) throw await failureOf(response)
  return response
}

export const sendSignedIn = async (path: string, init: RequestInit): Promise<Response> => {
  const token = await readToken()
  const headers = new Headers(init.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  try {
    return await send(path, { ...init, headers })
  } catch (error) {
    const rejected = error instanceof ApiFailure && error.code === 'unauthorized'
    if (rejected && (await readToken()) === token) await clearToken()
    throw error
  }
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

export const reconnectDelayMs = 3000
export const maxReconnects = 20

const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })

export const readRecognition = async (
  body: CreateRecognitionRequest,
  signal: AbortSignal,
  onEvent: (event: RecognitionEvent) => void,
): Promise<RecognitionState> => {
  const { recognitionId } = await createRecognition(body, signal)
  let state = await getRecognition(recognitionId, signal)
  for (let reconnects = 0; !isFinished(state); reconnects += 1) {
    if (reconnects > maxReconnects) throw new ApiFailure('stalled', strings.read.stalled)
    if (reconnects > 0) await pause(reconnectDelayMs, signal)
    let last: RecognitionEvent | undefined
    for await (const event of recognitionEvents(recognitionId, signal)) {
      onEvent(event)
      last = event
    }
    if (last?.event === 'failed') return { recognitionId, status: 'failed', error: last.data }
    state = await getRecognition(recognitionId, signal)
  }
  return state
}

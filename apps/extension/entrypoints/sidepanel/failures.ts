import type { Transcription } from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { ApiFailure, VersionConflictFailure } from '../../api/client.ts'
import { readToken } from '../../api/token.ts'

const retryableCodes = new Set(['too_many_requests', 'internal_error', 'shutting_down'])

export type RequestProblem =
  | { kind: 'conflict'; current: Transcription }
  | { kind: 'signed-out' }
  | { kind: 'failed'; message: string; offline: boolean; retryable: boolean }

export const transportProblemOf = (error: unknown) => {
  const offline = error instanceof TypeError
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
  const message = offline
    ? strings.read.offline
    : timedOut
      ? strings.read.timedOut
      : strings.read.badResponse
  return { message, offline }
}

export const problemOf = async (error: unknown): Promise<RequestProblem> => {
  if (error instanceof VersionConflictFailure) return { kind: 'conflict', current: error.current }
  const unauthorized = error instanceof ApiFailure && error.code === 'unauthorized'
  if (unauthorized && (await readToken()) === undefined) return { kind: 'signed-out' }
  if (error instanceof ApiFailure) {
    const retryable = unauthorized || retryableCodes.has(error.code)
    return { kind: 'failed', message: error.message, offline: false, retryable }
  }
  return { kind: 'failed', ...transportProblemOf(error), retryable: true }
}

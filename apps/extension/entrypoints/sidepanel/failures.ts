import type { Transcription } from '@khronist/contracts'
import { strings, type StatusBar } from '@khronist/ui'
import type { ComponentProps } from 'react'
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
  const failure = requestFailureOf(error)
  return { kind: 'failed', ...failure, retryable: unauthorized || failure.retryable }
}

export type RequestFailure = Omit<Extract<RequestProblem, { kind: 'failed' }>, 'kind'>

export const requestFailureOf = (error: unknown): RequestFailure =>
  error instanceof ApiFailure
    ? { message: error.message, offline: false, retryable: retryableCodes.has(error.code) }
    : { ...transportProblemOf(error), retryable: true }

type FailureActions = { onRetry: () => void; onDismiss: () => void; dismissLabel?: string }

export const failureAlertOf = (
  { message, offline, retryable }: RequestFailure,
  { onRetry, onDismiss, dismissLabel = strings.account.dismiss }: FailureActions,
): ComponentProps<typeof StatusBar> => ({
  type: offline ? 'error' : 'warning',
  message,
  action: retryable ? strings.read.retry : dismissLabel,
  onAction: retryable ? onRetry : onDismiss,
})

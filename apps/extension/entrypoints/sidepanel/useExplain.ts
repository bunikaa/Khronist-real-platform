import {
  explainRequestSchema,
  type Entity,
  type ExplainRequest,
  type ExplainResponse,
} from '@khronist/contracts'
import { useCallback, useRef, useState } from 'react'
import { ApiFailure } from '../../api/client.ts'
import { explain } from '../../api/explain.ts'
import { transportProblemOf, type RequestFailure } from './failures.ts'

export type ShownEntity = { type: Entity['type']; text: string; normalized?: string }

type ExplanationState =
  | { status: 'loading' }
  | { status: 'answered'; response: ExplainResponse }
  | { status: 'failed'; problem: RequestFailure }

type Opened = {
  transcriptionId: string
  entity: ShownEntity
  request: number
  explanation: ExplanationState
}

const explainTimeoutMs = 35_000

const kinds: Record<Entity['type'], ExplainRequest['kind']> = {
  person: 'entity',
  place: 'place',
  date: 'date',
  term: 'term',
}

const finalCodes = new Set(['bad_request', 'too_large', 'too_many_requests'])

const askedText = ({ type, text, normalized }: ShownEntity) =>
  type === 'date' ? normalized?.trim() || text : text

export const explainRequestFor = (
  entity: ShownEntity,
  transcriptionId: string,
): ExplainRequest => ({
  kind: kinds[entity.type],
  text: askedText(entity),
  context: { transcriptionId },
})

export const canExplain = (entity: ShownEntity) =>
  explainRequestSchema.shape.text.safeParse(askedText(entity)).success

export const explainProblemOf = (error: unknown): RequestFailure => {
  if (error instanceof ApiFailure) {
    return { message: error.message, offline: false, retryable: !finalCodes.has(error.code) }
  }
  return { ...transportProblemOf(error), retryable: true }
}

const answers = new Map<string, ExplainResponse>()
const pending = new Map<string, Promise<ExplainResponse>>()

const answerFor = (key: string, request: ExplainRequest) => {
  const asked = pending.get(key)
  if (asked) return asked
  const answer = explain(request, AbortSignal.timeout(explainTimeoutMs)).then((response) => {
    if (response.answer !== null) answers.set(key, response)
    return response
  })
  const forget = () => pending.delete(key)
  answer.then(forget, forget)
  pending.set(key, answer)
  return answer
}

export const useExplain = (transcriptionId: string) => {
  const [opened, setOpened] = useState<Opened>()
  const requests = useRef(0)

  const open = useCallback(
    (entity: ShownEntity) => {
      requests.current += 1
      const request = requests.current
      const asked = explainRequestFor(entity, transcriptionId)
      const key = JSON.stringify([transcriptionId, asked.kind, asked.text])
      const show = (explanation: ExplanationState) =>
        setOpened({ transcriptionId, entity, request, explanation })
      const known = answers.get(key)
      if (known) return show({ status: 'answered', response: known })
      show({ status: 'loading' })
      const settle = (explanation: ExplanationState) =>
        setOpened((current) =>
          current?.request === request ? { ...current, explanation } : current,
        )
      answerFor(key, asked).then(
        (response) => settle({ status: 'answered', response }),
        (error: unknown) => settle({ status: 'failed', problem: explainProblemOf(error) }),
      )
    },
    [transcriptionId],
  )

  const close = useCallback(() => setOpened(undefined), [])
  const shown = opened?.transcriptionId === transcriptionId ? opened : undefined

  return {
    opened: shown,
    open,
    close,
    retry: () => {
      if (shown) open(shown.entity)
    },
  }
}

export type Explaining = ReturnType<typeof useExplain>

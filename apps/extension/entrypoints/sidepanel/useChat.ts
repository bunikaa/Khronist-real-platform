import type { ChatRequest, ChatResponse, Transcription } from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { askChat } from '../../api/chat.ts'
import { ApiFailure } from '../../api/client.ts'
import { transportProblemOf } from './failures.ts'

export type ChatTurn = { question: string; reply: ChatResponse; withRecord: boolean }

type ChatProblem = {
  message: string
  offline: boolean
  action: 'retry' | 'dismiss' | 'restart'
}

const historyWindow = 6
const chatTimeoutMs = 45_000

const restartCodes = new Set(['bad_request', 'too_large'])
const noTurns: ChatTurn[] = []

export const answerText = ({ reply, withRecord }: ChatTurn) =>
  reply.answer ?? strings.chat.unknown(withRecord)

export const chatMessages = (turns: ChatTurn[], question: string): ChatRequest['messages'] => {
  const history = turns.flatMap((turn) => [
    { role: 'user' as const, content: turn.question },
    { role: 'assistant' as const, content: answerText(turn) },
  ])
  const window = [...history, { role: 'user' as const, content: question }].slice(-historyWindow)
  return window[0]?.role === 'assistant' ? window.slice(1) : window
}

export const chatProblemOf = (error: unknown): ChatProblem => {
  if (error instanceof ApiFailure) {
    if (restartCodes.has(error.code))
      return { message: strings.chat.restartNeeded, offline: false, action: 'restart' }
    const action = error.code === 'too_many_requests' ? 'dismiss' : 'retry'
    return { message: error.message, offline: false, action }
  }
  return { ...transportProblemOf(error), action: 'retry' }
}

type Pending = { question: string; controller: AbortController }

const requestAnswer = (
  turns: ChatTurn[],
  question: string,
  transcriptionId: string | undefined,
  signal: AbortSignal,
) =>
  askChat(
    {
      messages: chatMessages(turns, question),
      context: transcriptionId ? { transcriptionId } : undefined,
    },
    AbortSignal.any([signal, AbortSignal.timeout(chatTimeoutMs)]),
  )

const keepDraft = (question: string) => (current: string) => (current.trim() ? current : question)

const usePendingQuestion = () => {
  const [asking, setAsking] = useState<string>()
  const pending = useRef<Pending>(undefined)

  const start = (question: string) => {
    if (pending.current) return undefined
    const started = { question, controller: new AbortController() }
    pending.current = started
    setAsking(question)
    return started
  }

  const settle = (settled: Pending, apply: () => void) => {
    if (pending.current !== settled) return
    pending.current = undefined
    setAsking(undefined)
    apply()
  }

  const abandon = useCallback(() => {
    const abandoned = pending.current
    pending.current = undefined
    setAsking(undefined)
    abandoned?.controller.abort()
    return abandoned?.question
  }, [])

  return { asking, start, settle, abandon }
}

const useNewRegion = (regionId: string | undefined, onNewRegion: () => void) => {
  const region = useRef<string>(undefined)
  useEffect(() => {
    if (regionId === undefined || regionId === region.current) return
    const previous = region.current
    region.current = regionId
    if (previous !== undefined) onNewRegion()
  }, [regionId, onNewRegion])
}

const useConversation = () => {
  const [turns, setTurns] = useState(noTurns)
  const [problem, setProblem] = useState<ChatProblem & { question: string }>()
  const [draft, setDraft] = useState('')

  const clear = useCallback((abandoned: string | undefined) => {
    if (abandoned) setDraft(keepDraft(abandoned))
    setTurns(noTurns)
    setProblem(undefined)
  }, [])

  const begin = (question: string) => {
    setProblem(undefined)
    setDraft((current) => (current.trim() === question ? '' : current))
  }

  const fail = (question: string, error: unknown) => {
    setProblem({ ...chatProblemOf(error), question })
    setDraft(keepDraft(question))
  }

  const answer = (turn: ChatTurn) => setTurns((current) => [...current, turn])
  const dismiss = () => setProblem(undefined)
  return { turns, problem, draft, setDraft, clear, begin, fail, answer, dismiss }
}

export const useChat = (transcription: Transcription | undefined) => {
  const [withRecord, setWithRecord] = useState(true)
  const { asking, start, settle, abandon } = usePendingQuestion()
  const conversation = useConversation()
  const { clear } = conversation
  const restart = useCallback(() => clear(abandon()), [clear, abandon])

  useNewRegion(transcription?.regionId, restart)

  const ask = (text: string) => {
    const question = text.trim()
    const started = question ? start(question) : undefined
    if (!started) return
    const transcriptionId = withRecord ? transcription?.id : undefined
    conversation.begin(question)
    requestAnswer(conversation.turns, question, transcriptionId, started.controller.signal).then(
      (reply) =>
        settle(started, () =>
          conversation.answer({ question, reply, withRecord: transcriptionId !== undefined }),
        ),
      (error: unknown) => settle(started, () => conversation.fail(question, error)),
    )
  }

  const { turns, problem, draft, setDraft, dismiss } = conversation
  return {
    turns,
    asking,
    problem,
    draft,
    withRecord,
    setDraft,
    setWithRecord,
    dismiss,
    restart,
    send: () => ask(draft),
    ask,
    retry: () => problem && ask(problem.question),
  }
}

export type Chat = ReturnType<typeof useChat>

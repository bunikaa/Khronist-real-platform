import type { ChatResponse } from '@khronist/contracts'
import { ChatComposer, ChatMessage, SourceRef, StatusBar, strings, Switch } from '@khronist/ui'
import { useEffect, useRef } from 'react'
import { answerText, type Chat, type ChatTurn } from './useChat.ts'
import type { Reading } from './useReading.ts'

type Citation = ChatResponse['citations'][number]

const sourceOf = (citation: Citation) =>
  citation.kind === 'record'
    ? { title: `«${citation.quote}»`, note: strings.chat.recordSource }
    : {
        title: citation.title,
        href: citation.url,
        note: strings.chat.chunkSource(citation.licence, citation.retelling),
      }

const Reply = ({ turn }: { turn: ChatTurn }) => {
  const { answer, confidence, citations } = turn.reply
  if (answer === null) return <ChatMessage kind="unknown">{answerText(turn)}</ChatMessage>
  return (
    <ChatMessage
      kind="answer"
      uncertain={confidence === 'low'}
      sources={citations.map((citation, index) => (
        <SourceRef key={index} number={index + 1} {...sourceOf(citation)} />
      ))}
    >
      {answer}
    </ChatMessage>
  )
}

const problemActions = {
  retry: strings.read.retry,
  dismiss: strings.account.dismiss,
  restart: strings.chat.restart,
}

const ChatAlert = ({ chat }: { chat: Chat }) => {
  const { problem } = chat
  if (!problem) return null
  return (
    <StatusBar
      type={problem.offline ? 'error' : 'warning'}
      message={problem.message}
      action={problemActions[problem.action]}
      onAction={chat[problem.action]}
    />
  )
}

const contextOf = (reading: Reading) => {
  if (reading.phase !== 'done') return undefined
  const page = reading.shelfmark ? strings.shelfmark.page(reading.shelfmark) : undefined
  return strings.chat.context(page, reading.transcription.lines.length)
}

const ContextRow = ({ label, chat }: { label: string; chat: Chat }) => (
  <>
    <div className="flex items-center gap-2 px-3 py-2">
      <p className="min-w-0 flex-1 font-mono text-mono-11 text-ink-muted">{label}</p>
      <Switch
        checked={chat.withRecord}
        label={strings.chat.contextSwitch}
        onChange={chat.setWithRecord}
      />
    </div>
    <hr className="border-rule" />
  </>
)

const Thread = ({ chat }: { chat: Chat }) => {
  const { turns, asking } = chat
  const questions = asking === undefined ? turns : [...turns, { question: asking }]
  return (
    <div aria-live="polite">
      {questions.length === 0 ? (
        <p className="px-3 py-8 text-center text-body-13 text-ink-muted">{strings.chat.intro}</p>
      ) : (
        <ol className="flex flex-col gap-4 px-3 py-4">
          {questions.flatMap((turn, index) => [
            <li key={`question-${index}`}>
              <ChatMessage kind="user">{turn.question}</ChatMessage>
            </li>,
            'reply' in turn ? (
              <li key={`reply-${index}`}>
                <Reply turn={turn} />
              </li>
            ) : (
              <li key={`reply-${index}`} className="text-body-13 text-ink-muted">
                {strings.chat.waiting}
              </li>
            ),
          ])}
        </ol>
      )}
    </div>
  )
}

const useScrollToLatest = (shown: boolean, latest: string) => {
  const thread = useRef<HTMLDivElement>(null)
  const scrolledFor = useRef<string>(undefined)
  useEffect(() => {
    const element = thread.current
    if (!element || !shown || scrolledFor.current === latest) return
    scrolledFor.current = latest
    element.scrollTop = element.scrollHeight
  }, [shown, latest])
  return thread
}

const useFocusOnRequest = (request: number) => {
  const field = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (request > 0) field.current?.focus()
  }, [request])
  return field
}

type AskTabProps = { chat: Chat; reading: Reading; shown: boolean; focusRequest: number }

export const AskTab = ({ chat, reading, shown, focusRequest }: AskTabProps) => {
  const thread = useScrollToLatest(shown, `${chat.turns.length}:${chat.asking ?? ''}`)
  const field = useFocusOnRequest(focusRequest)
  const context = contextOf(reading)
  return (
    <>
      <ChatAlert chat={chat} />
      {context && <ContextRow label={context} chat={chat} />}
      <div ref={thread} className="flex-1 overflow-y-auto">
        <Thread chat={chat} />
      </div>
      <ChatComposer
        inputRef={field}
        value={chat.draft}
        placeholder={strings.chat.placeholder(context !== undefined && chat.withRecord)}
        busy={chat.asking !== undefined}
        followups={chat.asking === undefined ? (chat.turns.at(-1)?.reply.followups ?? []) : []}
        onChange={chat.setDraft}
        onSend={chat.send}
        onFollowup={chat.ask}
      />
    </>
  )
}

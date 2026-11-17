import { maxChatMessageLength } from '@khronist/contracts'
import { Send } from 'lucide-react'
import type { RefObject } from 'react'
import { fieldFocus, fieldFrame } from './field.ts'
import { strings } from './strings.uk.ts'

type FollowupsProps = { questions: string[]; onAsk: (question: string) => void }

const Followups = ({ questions, onAsk }: FollowupsProps) => (
  <ul aria-label={strings.chat.followups} className="flex flex-wrap gap-1.5">
    {questions.map((question, index) => (
      <li key={index} className="flex max-w-full">
        <button
          type="button"
          onClick={() => onAsk(question)}
          className="min-h-[22px] max-w-full cursor-pointer rounded-[11px] border border-rule px-2 py-[2px] text-left text-body-12 break-words hover:bg-base-200"
        >
          {question}
        </button>
      </li>
    ))}
  </ul>
)

type ChatComposerProps = {
  inputRef: RefObject<HTMLInputElement | null>
  value: string
  placeholder: string
  busy: boolean
  followups: string[]
  onChange: (value: string) => void
  onSend: () => void
  onFollowup: (question: string) => void
}

export const ChatComposer = (props: ChatComposerProps) => {
  const { inputRef, value, placeholder, busy, followups, onChange } = props
  const ready = !busy && value.trim() !== ''
  const keepFocus = (action: () => void) => {
    action()
    inputRef.current?.focus()
  }
  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-rule bg-base-100 px-3 py-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) keepFocus(props.onSend)
      }}
    >
      {followups.length > 0 && (
        <Followups
          questions={followups}
          onAsk={(question) => keepFocus(() => props.onFollowup(question))}
        />
      )}
      <div className={`${fieldFrame} ${fieldFocus} flex h-9 items-center gap-2 px-3`}>
        <input
          ref={inputRef}
          aria-label={strings.chat.question}
          value={value}
          maxLength={maxChatMessageLength}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-body-13 text-base-content outline-none placeholder:text-ink-muted"
        />
        <button
          type="submit"
          aria-label={strings.chat.send}
          disabled={!ready}
          className="shrink-0 cursor-pointer text-primary disabled:cursor-default disabled:text-ink-muted"
        >
          <Send size={16} aria-hidden />
        </button>
      </div>
    </form>
  )
}

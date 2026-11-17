import { CircleAlert } from 'lucide-react'
import type { ReactNode } from 'react'
import { strings } from './strings.uk.ts'

type ChatMessageProps =
  | { kind: 'user'; children: string }
  | { kind: 'answer'; children: string; uncertain: boolean; sources: ReactNode[] }
  | { kind: 'unknown'; children: string }

export const ChatMessage = (props: ChatMessageProps) => {
  if (props.kind === 'user')
    return (
      <p className="ml-auto w-[78%] rounded-box bg-base-200 px-3 py-2 text-body-13 break-words whitespace-pre-wrap">
        {props.children}
      </p>
    )
  return (
    <div className="flex flex-col gap-2">
      <p className="text-label-section text-ink-muted uppercase">{strings.chat.author}</p>
      {props.kind === 'answer' && props.uncertain && (
        <p className="flex gap-2 text-body-13">
          <CircleAlert size={16} className="mt-px shrink-0 text-warning" aria-hidden />
          {strings.chat.lowConfidence}
        </p>
      )}
      <p
        className={`text-body-14 break-words whitespace-pre-wrap ${props.kind === 'unknown' ? 'text-ink-muted' : ''}`}
      >
        {props.children}
      </p>
      {props.kind === 'answer' && props.sources.length > 0 && (
        <ol aria-label={strings.chat.sources} className="flex flex-col gap-1">
          {props.sources}
        </ol>
      )}
    </div>
  )
}

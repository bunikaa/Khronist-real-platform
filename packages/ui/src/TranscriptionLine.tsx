import { maxLineLength, type Line } from '@khronist/contracts'
import { Fragment, type ComponentProps } from 'react'
import { strings } from './strings.uk.ts'

type Words = { text: string; uncertain: boolean }[]

type LineWordsProps = {
  text: string
  uncertain: boolean
  words: Words
}

const Uncertain = ({ text }: { text: string }) => (
  <span
    className="underline decoration-warning decoration-dotted decoration-2 underline-offset-2"
    title={strings.read.uncertainWord}
  >
    {text}
    <span className="sr-only select-none"> ({strings.read.uncertainMark})</span>
  </span>
)

export const LineWords = ({ text, uncertain, words }: LineWordsProps) => {
  if (words.length === 0) return uncertain ? <Uncertain text={text} /> : text
  return words.map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      {word.uncertain ? <Uncertain text={word.text} /> : word.text}
    </Fragment>
  ))
}

const LineNumber = ({ idx }: { idx: number }) => (
  <span className="w-5 shrink-0 font-mono text-mono-11 text-ink-muted">
    {String(idx + 1).padStart(2, '0')}
  </span>
)

type TranscriptionLineProps = {
  line: Line
  changed?: boolean
  onEdit?: () => void
}

export const TranscriptionLine = ({ line, changed = false, onEdit }: TranscriptionLineProps) => {
  const content = (
    <>
      {changed && (
        <span className="absolute top-2 left-0.75 size-1.5 rounded-full bg-primary" aria-hidden />
      )}
      <LineNumber idx={line.idx} />
      <span className="min-w-0 flex-1 font-mono text-mono-transcription">
        <LineWords text={line.text} uncertain={line.uncertain} words={line.words} />
        {changed && <span className="sr-only"> ({strings.edit.changed})</span>}
      </span>
    </>
  )
  const className = `relative flex w-full gap-2 rounded p-1 text-left ${changed ? 'pl-3.5' : ''}`
  return (
    <li>
      {onEdit ? (
        <button type="button" className={`${className} hover:bg-base-300`} onClick={onEdit}>
          {content}
        </button>
      ) : (
        <div className={className}>{content}</div>
      )}
    </li>
  )
}

type TranscriptionLineInputProps = Omit<ComponentProps<'textarea'>, 'className'> & {
  idx: number
}

export const TranscriptionLineInput = ({ idx, ...props }: TranscriptionLineInputProps) => (
  <div className="flex gap-2 rounded border border-base-content bg-base-100 p-1">
    <LineNumber idx={idx} />
    <textarea
      rows={1}
      maxLength={maxLineLength}
      aria-label={strings.edit.line(idx + 1)}
      className="field-sizing-content min-w-0 flex-1 resize-none bg-transparent font-mono text-mono-transcription outline-none"
      {...props}
    />
  </div>
)

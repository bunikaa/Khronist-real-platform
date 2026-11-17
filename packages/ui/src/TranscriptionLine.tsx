import { maxLineLength, type Line } from '@khronist/contracts'
import { Fragment, type ComponentProps } from 'react'
import { strings } from './strings.uk.ts'

type Words = { text: string; uncertain: boolean }[]

type MarkedLine = {
  text: string
  uncertain: boolean
  words: Words
}

const markedWords = ({ text, uncertain, words }: MarkedLine): Words =>
  words.length === 0 ? [{ text, uncertain }] : words

export const hasUncertainMark = (line: MarkedLine) =>
  markedWords(line).some((word) => word.uncertain)

type UncertainProps = { text: string; hint: string; mark: string }

const Uncertain = ({ text, hint, mark }: UncertainProps) => (
  <span
    className="underline decoration-warning decoration-dotted decoration-2 underline-offset-2"
    title={hint}
  >
    {text}
    <span className="sr-only select-none"> ({mark})</span>
  </span>
)

export const LineWords = (line: MarkedLine) =>
  markedWords(line).map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      {word.uncertain ? (
        <Uncertain
          text={word.text}
          hint={strings.read.uncertainWord}
          mark={strings.read.uncertainMark}
        />
      ) : (
        word.text
      )}
    </Fragment>
  ))

const LineNumber = ({ idx }: { idx: number }) => (
  <span className="w-5 shrink-0 font-mono text-mono-11 text-ink-muted">
    {String(idx + 1).padStart(2, '0')}
  </span>
)

const noBreakSpace = '\u00a0'

type TranslatedLineProps = { idx: number; text: string; uncertain: boolean }

export const TranslatedLine = ({ idx, text, uncertain }: TranslatedLineProps) => {
  const marked = uncertain ? (
    <Uncertain
      text={text}
      hint={strings.read.uncertainLine}
      mark={strings.read.uncertainLineMark}
    />
  ) : (
    text
  )
  return (
    <li className="flex gap-2 px-1">
      <LineNumber idx={idx} />
      <span className="min-w-0 flex-1">{text.trim() === '' ? noBreakSpace : marked}</span>
    </li>
  )
}

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

import type { Line } from '@khronist/contracts'
import { Fragment } from 'react'
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

type TranscriptionLineProps = {
  line: Line
}

export const TranscriptionLine = ({ line }: TranscriptionLineProps) => (
  <li className="flex gap-2 rounded p-1 hover:bg-base-300">
    <span className="w-5 shrink-0 font-mono text-mono-11 text-ink-muted">
      {String(line.idx + 1).padStart(2, '0')}
    </span>
    <span className="min-w-0 flex-1 font-mono text-mono-transcription">
      <LineWords text={line.text} uncertain={line.uncertain} words={line.words} />
    </span>
  </li>
)

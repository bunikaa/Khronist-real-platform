import type { Line } from '@khronist/contracts'
import { Fragment } from 'react'
import { strings } from './strings.uk.ts'

type TranscriptionLineProps = {
  line: Line
}

const uncertainClass = 'text-warning underline'

const LineText = ({ line }: TranscriptionLineProps) => {
  if (line.words.length === 0) {
    return line.uncertain ? (
      <span className={uncertainClass} title={strings.read.uncertainWord}>
        {line.text}
      </span>
    ) : (
      line.text
    )
  }
  return line.words.map((word, index) => (
    <Fragment key={index}>
      {index > 0 && ' '}
      {word.uncertain ? (
        <span className={uncertainClass} title={strings.read.uncertainWord}>
          {word.text}
        </span>
      ) : (
        word.text
      )}
    </Fragment>
  ))
}

export const TranscriptionLine = ({ line }: TranscriptionLineProps) => (
  <li className="flex gap-2 rounded p-1 hover:bg-base-300">
    <span className="w-5 shrink-0 font-mono text-mono-11 text-ink-muted">
      {String(line.idx + 1).padStart(2, '0')}
    </span>
    <span className="min-w-0 flex-1 font-mono text-mono-transcription">
      <LineText line={line} />
    </span>
  </li>
)

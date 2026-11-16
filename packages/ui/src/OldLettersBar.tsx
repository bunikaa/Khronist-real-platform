import { strings } from './strings.uk.ts'

const oldLetters = ['ѣ', 'і', 'ъ', 'ѳ', 'ѵ', 'ѡ', 'ѧ', 'ѹ']

type OldLettersBarProps = {
  onInsert: (letter: string) => void
}

export const OldLettersBar = ({ onInsert }: OldLettersBarProps) => (
  <div role="group" aria-label={strings.edit.oldLetters} className="flex flex-wrap gap-1">
    {oldLetters.map((letter) => (
      <button
        key={letter}
        type="button"
        aria-label={strings.edit.insert(letter)}
        className="flex size-6 items-center justify-center rounded bg-base-200 font-mono text-mono-transcription"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onInsert(letter)}
      >
        {letter}
      </button>
    ))}
  </div>
)

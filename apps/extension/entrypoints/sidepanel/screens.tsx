import type { Line, RecognitionStatus, Transcription } from '@khronist/contracts'
import {
  ActionBar,
  Button,
  LineWords,
  SectionLabel,
  StatusBar,
  strings,
  TranscriptionLine,
} from '@khronist/ui'
import { Check, CircleAlert, Crosshair } from 'lucide-react'
import type { Fragment } from '../../messages.ts'
import type { Failure } from './useReading.ts'

type Action = () => void

const FragmentPreview = ({ fragment, failed }: { fragment: Fragment; failed?: boolean }) => (
  <div className="flex flex-col gap-1">
    <figure
      className={`relative h-30 overflow-hidden rounded border-[1.25px] border-dashed bg-base-300 ${failed ? 'border-error' : 'border-primary'}`}
    >
      <img
        src={`data:image/png;base64,${fragment.base64Png}`}
        alt=""
        className="h-full w-full object-contain"
      />
      <figcaption className="absolute bottom-2.5 left-3 rounded-sm bg-base-300 px-1 font-mono text-mono-10 text-ink-muted">
        {strings.read.fragment(fragment.width, fragment.height)}
      </figcaption>
    </figure>
    {fragment.scaledFrom && (
      <p className="text-body-12 text-ink-muted">
        {strings.read.scaledFrom(fragment.scaledFrom.width, fragment.scaledFrom.height)}
      </p>
    )}
  </div>
)

const Notes = ({ notes }: { notes: string[] }) => (
  <ul className="flex flex-col gap-1">
    {notes.map((note) => (
      <li key={note} className="flex gap-2 text-body-13">
        <CircleAlert size={16} className="mt-px shrink-0 text-warning" aria-hidden />
        {note}
      </li>
    ))}
  </ul>
)

const Lines = ({ lines }: { lines: Line[] }) => (
  <ol className="flex flex-col gap-1">
    {lines.map((line) => (
      <TranscriptionLine key={line.idx} line={line} />
    ))}
  </ol>
)

export const MissingPage = () => (
  <main className="flex-1 overflow-y-auto">
    <section className="flex flex-col items-center gap-3 px-3 py-8 text-center">
      <h2 className="text-heading-16">{strings.page.missingTitle}</h2>
      <p className="text-body-13 text-ink-muted">{strings.page.missingBody}</p>
    </section>
  </main>
)

type ReadyToReadProps = { onSelect: Action; shortcut: string | undefined }

export const ReadyToRead = ({ onSelect, shortcut }: ReadyToReadProps) => (
  <>
    <main className="flex-1 overflow-y-auto">
      <section className="flex flex-col items-center gap-3 px-3 py-8 text-center">
        <Crosshair
          size={32}
          strokeWidth={4 / 3}
          absoluteStrokeWidth
          className="text-ink-muted"
          aria-hidden
        />
        <h2 className="text-heading-16">{strings.read.promptTitle}</h2>
        <p className="text-body-13 text-ink-muted">{strings.read.promptBody(shortcut)}</p>
      </section>
    </main>
    <ActionBar>
      <Button onClick={onSelect}>{strings.read.selectFragment}</Button>
    </ActionBar>
  </>
)

export const Selecting = ({ onCancel }: { onCancel: Action }) => (
  <>
    <main className="flex-1 overflow-y-auto">
      <section className="flex flex-col items-center gap-3 px-3 py-8 text-center opacity-50">
        <h2 className="text-heading-16">{strings.read.selectingTitle}</h2>
        <p className="font-mono text-mono-11 text-ink-muted">{strings.read.selectingHint}</p>
      </section>
    </main>
    <ActionBar>
      <Button kind="ghost" onClick={onCancel}>
        {strings.read.cancel}
      </Button>
    </ActionBar>
  </>
)

type StepState = 'done' | 'active' | 'pending'

const Step = ({ state, label }: { state: StepState; label: string }) => (
  <li
    className={`flex items-center gap-2 text-body-13 ${state === 'pending' ? 'text-ink-muted' : ''}`}
  >
    <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
      {state === 'done' && <Check size={16} className="text-success" />}
      {state === 'active' && <span className="size-2 rounded-full bg-primary" />}
      {state === 'pending' && <span className="size-2 rounded-full border border-rule" />}
    </span>
    {label}
  </li>
)

type ReadingProps = {
  fragment: Fragment
  status: RecognitionStatus
  lines: Line[]
  onCancel: Action
}

export const Reading = ({ fragment, status, lines, onCancel }: ReadingProps) => {
  const read = status === 'normalizing' || lines.length > 0
  return (
    <>
      <main className="flex-1 overflow-y-auto">
        <section className="flex flex-col gap-3 p-3">
          <FragmentPreview fragment={fragment} />
          <ol className="flex flex-col gap-2">
            <Step
              state={read ? 'done' : 'active'}
              label={read ? strings.read.read(lines.length) : strings.read.reading}
            />
            <Step
              state={status === 'normalizing' ? 'active' : 'pending'}
              label={strings.read.normalizing}
            />
          </ol>
        </section>
        <hr className="border-rule" />
        <section className="flex flex-col gap-2 p-3">
          <SectionLabel>
            {lines.length > 0
              ? strings.read.transcriptionLines(lines.length)
              : strings.read.transcription}
          </SectionLabel>
          {lines.length > 0 ? (
            <Lines lines={lines} />
          ) : (
            <div className="flex flex-col gap-2" aria-hidden>
              <span className="h-2.5 w-55 rounded-[3px] bg-base-300" />
              <span className="h-2.5 w-40 rounded-[3px] bg-base-300" />
            </div>
          )}
        </section>
      </main>
      <ActionBar>
        <Button kind="ghost" onClick={onCancel}>
          {strings.read.cancel}
        </Button>
      </ActionBar>
    </>
  )
}

export const modernLines = (transcription: Transcription) => {
  const normalized = transcription.normalizedLines
  if (!normalized) return null
  const changed = normalized.some((line, index) => line.text !== transcription.lines[index]?.text)
  return changed ? normalized : null
}

type ResultProps = {
  transcription: Transcription
  onSelect: Action
}

export const Result = ({ transcription, onSelect }: ResultProps) => {
  const modern = modernLines(transcription)
  const expansions = transcription.expansions ?? []
  const warnings = transcription.warnings ?? []
  return (
    <>
      <main className="flex-1 overflow-y-auto">
        {warnings.length > 0 && (
          <section className="p-3 pb-0">
            <Notes notes={warnings.map((warning) => strings.read.warnings[warning])} />
          </section>
        )}
        <section className="flex flex-col gap-1 p-3">
          <SectionLabel>{strings.read.transcriptionLines(transcription.lines.length)}</SectionLabel>
          <Lines lines={transcription.lines} />
        </section>
        {modern && (
          <>
            <hr className="border-rule" />
            <section className="flex flex-col gap-2 p-3">
              <SectionLabel>{strings.read.normalized}</SectionLabel>
              <div className="text-body-14">
                {modern.map((line, index) => (
                  <p key={index}>
                    <LineWords text={line.text} uncertain={false} words={line.words} />
                  </p>
                ))}
              </div>
              {expansions.length > 0 && (
                <>
                  <SectionLabel>{strings.read.expansions}</SectionLabel>
                  <ul className="text-body-13">
                    {expansions.map(({ from, to }, index) => (
                      <li key={index}>{strings.read.expansion(from, to)}</li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </>
        )}
      </main>
      <ActionBar>
        <Button onClick={onSelect}>{strings.read.selectFragment}</Button>
      </ActionBar>
    </>
  )
}

type FailedProps = {
  fragment?: Fragment | undefined
  failure: Failure
  onSelect: Action
  onRetry: Action
}

const retriable = (failure: Failure) => failure.kind === 'retry' || failure.kind === 'offline'

export const Failed = ({ fragment, failure, onSelect, onRetry }: FailedProps) => (
  <>
    <StatusBar
      type={failure.kind === 'offline' ? 'error' : 'warning'}
      message={failure.message}
      action={retriable(failure) && fragment ? strings.read.retry : strings.read.selectAgain}
      onAction={retriable(failure) && fragment ? onRetry : onSelect}
    />
    <main className="flex-1 overflow-y-auto">
      <section className="flex flex-col gap-3 p-3">
        {fragment && <FragmentPreview fragment={fragment} failed />}
        {failure.kind === 'unreadable' && (
          <>
            <SectionLabel>{strings.read.helps}</SectionLabel>
            {strings.read.tips.map((tip) => (
              <p key={tip} className="flex gap-2 text-body-13">
                <span className="text-ink-muted" aria-hidden>
                  ·
                </span>
                {tip}
              </p>
            ))}
          </>
        )}
      </section>
    </main>
    <ActionBar>
      <Button onClick={onSelect}>{strings.read.selectFragment}</Button>
    </ActionBar>
  </>
)

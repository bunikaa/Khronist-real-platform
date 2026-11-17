import { citeRequestSchema, type CiteRequest } from '@khronist/contracts'
import { useId, useRef, type ReactNode, type RefObject } from 'react'
import { BottomSheet } from './BottomSheet.tsx'
import { Button } from './Button.tsx'
import { strings } from './strings.uk.ts'
import { Switch } from './Switch.tsx'

type CitationFormat = CiteRequest['format']

const formats = citeRequestSchema.shape.format.options

type CitationSheetProps = {
  format: CitationFormat
  withTranscription: boolean
  text?: string
  loading?: boolean
  locked?: boolean
  copied?: boolean
  alert?: ReactNode
  onFormatChange: (format: CitationFormat) => void
  onWithTranscriptionChange: (withTranscription: boolean) => void
  onCopy: () => void
  onClose: () => void
}

type FormatSwitchProps = Pick<CitationSheetProps, 'format' | 'locked' | 'onFormatChange'> & {
  chosenRef: RefObject<HTMLInputElement | null>
}

const FormatSwitch = ({ format, locked = false, chosenRef, onFormatChange }: FormatSwitchProps) => {
  const name = useId()
  return (
    <div
      role="radiogroup"
      aria-label={strings.cite.format}
      className="flex h-7 rounded-[4px] bg-base-200 p-0.5"
    >
      {formats.map((option) => (
        <label
          key={option}
          className="flex flex-1 cursor-pointer items-center justify-center rounded-[4px] text-body-12 text-ink-muted has-checked:bg-base-100 has-checked:text-base-content has-focus-visible:outline-2 has-focus-visible:outline-base-content has-disabled:cursor-not-allowed has-disabled:opacity-50"
        >
          <input
            ref={option === format ? chosenRef : undefined}
            type="radio"
            className="sr-only"
            name={name}
            checked={option === format}
            disabled={locked}
            onChange={() => onFormatChange(option)}
          />
          {strings.cite.formats[option]}
        </label>
      ))}
    </div>
  )
}

type PreviewProps = Pick<CitationSheetProps, 'text' | 'loading'>

const Preview = ({ text, loading }: PreviewProps) => {
  if (text !== undefined)
    return (
      <pre
        tabIndex={0}
        className="max-h-[40vh] overflow-y-auto rounded-[4px] bg-base-200 p-3 font-mono text-mono-11 whitespace-pre-wrap wrap-anywhere"
      >
        {text}
      </pre>
    )
  if (loading)
    return (
      <p role="status" className="rounded-[4px] bg-base-200 p-3 text-body-12 text-ink-muted">
        {strings.cite.loading}
      </p>
    )
  return null
}

type TranscriptionToggleProps = Pick<
  CitationSheetProps,
  'withTranscription' | 'locked' | 'onWithTranscriptionChange'
>

const TranscriptionToggle = ({
  withTranscription,
  locked = false,
  onWithTranscriptionChange,
}: TranscriptionToggleProps) => {
  const id = useId()
  return (
    <div className="flex items-center gap-2 text-body-13">
      <Switch
        id={id}
        checked={withTranscription}
        label={strings.cite.withTranscription}
        disabled={locked}
        onChange={onWithTranscriptionChange}
      />
      <label htmlFor={id} className={locked ? 'text-ink-muted' : 'cursor-pointer'}>
        {strings.cite.withTranscription}
      </label>
    </div>
  )
}

export const CitationSheet = (props: CitationSheetProps) => {
  const { format, text, loading = false, locked = false, copied = false, alert } = props
  const titleId = useId()
  const chosenFormat = useRef<HTMLInputElement>(null)
  return (
    <BottomSheet
      labelledBy={titleId}
      focusRef={chosenFormat}
      alerting={alert !== undefined}
      onClose={props.onClose}
    >
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3">
        <h2 id={titleId} className="text-label-section text-ink-muted uppercase">
          {strings.cite.title}
        </h2>
        <FormatSwitch
          format={format}
          locked={locked}
          chosenRef={chosenFormat}
          onFormatChange={props.onFormatChange}
        />
        <Preview text={text} loading={loading} />
        {alert}
        <TranscriptionToggle {...props} />
      </div>
      <div className="flex gap-2 px-3" aria-live="polite">
        <Button disabled={text === undefined} onClick={props.onCopy}>
          {copied ? strings.cite.copied : strings.cite.copy}
        </Button>
      </div>
    </BottomSheet>
  )
}

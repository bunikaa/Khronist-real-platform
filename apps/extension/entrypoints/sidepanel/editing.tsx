import { maxLineLength } from '@khronist/contracts'
import {
  OldLettersBar,
  PageStatusBadge,
  StatusBar,
  strings,
  TranscriptionLine,
  TranscriptionLineInput,
} from '@khronist/ui'
import {
  useLayoutEffect,
  useRef,
  type ChangeEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react'
import type { LineChange } from '../../api/transcriptions.ts'
import { cleanLineText } from './lineEditing.ts'
import type { LineEditing } from './useLineEditing.ts'

const placeCaret = (element: HTMLTextAreaElement | null, at: number) => {
  element?.focus()
  element?.setSelectionRange(at, at)
}

const useCaretInsert = (text: string, change: (text: string) => void) => {
  const field = useRef<HTMLTextAreaElement>(null)
  const caret = useRef<number>(undefined)

  useLayoutEffect(() => placeCaret(field.current, field.current?.value.length ?? 0), [])

  useLayoutEffect(() => {
    if (caret.current === undefined) return
    placeCaret(field.current, caret.current)
    caret.current = undefined
  }, [text])

  const insert = (letter: string) => {
    const element = field.current
    if (!element) return
    const { selectionStart, selectionEnd } = element
    const next = text.slice(0, selectionStart) + letter + text.slice(selectionEnd)
    if (next.length > maxLineLength) return
    caret.current = selectionStart + letter.length
    change(next)
  }

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const { value, selectionStart } = event.target
    const clean = cleanLineText(value)
    if (clean !== value) {
      const at = cleanLineText(value.slice(0, selectionStart)).length
      requestAnimationFrame(() => placeCaret(field.current, at))
    }
    change(clean)
  }

  return { field, insert, onChange }
}

type EditingLineProps = { open: LineChange; editing: LineEditing }

const EditingLine = ({ open: { idx, text }, editing }: EditingLineProps) => {
  const { field, insert, onChange } = useCaretInsert(text, editing.change)

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') editing.cancel()
  }

  const onFieldKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    event.preventDefault()
    editing.next()
  }

  const onBlur = (event: FocusEvent) => {
    if (event.currentTarget.contains(event.relatedTarget) || !document.hasFocus()) return
    editing.commit()
  }

  return (
    <li className="flex flex-col gap-1" onKeyDown={onKeyDown} onBlur={onBlur}>
      <TranscriptionLineInput
        ref={field}
        idx={idx}
        value={text}
        onChange={onChange}
        onKeyDown={onFieldKeyDown}
      />
      <OldLettersBar onInsert={insert} />
    </li>
  )
}

const keepFieldFocused = (event: MouseEvent) => {
  if (!(event.target instanceof HTMLTextAreaElement)) event.preventDefault()
}

export const EditableLines = ({ editing }: { editing: LineEditing }) => (
  <ol className="flex flex-col gap-1" {...(editing.editing && { onMouseDown: keepFieldFocused })}>
    {editing.lines.map(({ line, changed }) =>
      editing.editing?.idx === line.idx ? (
        <EditingLine key={line.idx} open={editing.editing} editing={editing} />
      ) : (
        <TranscriptionLine
          key={line.idx}
          line={line}
          changed={changed}
          {...(editing.editable && { onEdit: () => editing.open(line.idx) })}
        />
      ),
    )}
  </ol>
)

export const EditingHint = () => (
  <>
    <section className="flex items-center gap-2 p-3">
      <PageStatusBadge status="editing">{strings.edit.editing}</PageStatusBadge>
      <p className="min-w-0 flex-1 text-right font-mono text-mono-10 text-ink-muted">
        {strings.edit.hint}
      </p>
    </section>
    <hr className="border-rule" />
  </>
)

type EditAlertProps = { editing: LineEditing; onSignIn: () => void }

export const EditAlert = ({ editing, onSignIn }: EditAlertProps) => {
  const { problem } = editing
  if (problem?.kind === 'conflict')
    return (
      <StatusBar
        type="warning"
        message={strings.edit.conflict}
        action={strings.edit.showCurrent}
        onAction={editing.showCurrent}
      />
    )
  if (problem?.kind === 'failed')
    return (
      <StatusBar
        type={problem.offline ? 'error' : 'warning'}
        message={problem.message}
        action={problem.retryable ? strings.read.retry : strings.edit.discard}
        onAction={problem.retryable ? editing.retry : editing.discard}
      />
    )
  if (editing.waitingForSignIn)
    return (
      <StatusBar
        type="info"
        message={strings.edit.signInToSave}
        action={strings.account.signInLabel}
        onAction={onSignIn}
      />
    )
  return null
}

import type { Transcription } from '@khronist/contracts'
import { EntityChip, LineWords, SectionLabel, strings } from '@khronist/ui'
import { CircleAlert } from 'lucide-react'
import { ConfirmActions, ConfirmAlert, PageStatus, VerifiedAlert } from './confirming.tsx'
import { ConflictCompare, EditableLines, EditAlert, EditingHint } from './editing.tsx'
import type { Confirming } from './useConfirm.ts'
import type { LineEditing } from './useLineEditing.ts'

export const modernLines = (transcription: Transcription) => {
  const normalized = transcription.normalizedLines
  if (!normalized) return null
  const changed = normalized.some((line, index) => line.text !== transcription.lines[index]?.text)
  return changed ? normalized : null
}

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

type ModernTextProps = {
  lines: NonNullable<Transcription['normalizedLines']>
  expansions: NonNullable<Transcription['expansions']>
}

const ModernText = ({ lines, expansions }: ModernTextProps) => (
  <section className="flex flex-col gap-2 p-3">
    <SectionLabel>{strings.read.normalized}</SectionLabel>
    <div className="text-body-14">
      {lines.map((line, index) => (
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
)

const lineBreak = /-\s*\n\s*/g
const spaces = /\s+/g

const shownText = (text: string) => text.replace(lineBreak, '').replace(spaces, ' ').trim()

export const distinctEntities = (entities: Transcription['entities']) =>
  entities
    .toSorted((a, b) => a.start - b.start || a.end - b.end)
    .map(({ type, text }) => ({ type, text: shownText(text) }))
    .filter(
      (entity, index, sorted) =>
        sorted.findIndex((other) => other.type === entity.type && other.text === entity.text) ===
        index,
    )

const Entities = ({ entities }: { entities: Transcription['entities'] }) => {
  const shown = distinctEntities(entities)
  if (shown.length === 0) return null
  return (
    <>
      <hr className="border-rule" />
      <section className="flex flex-col gap-2 p-3">
        <SectionLabel>{strings.entity.section}</SectionLabel>
        <ul className="flex flex-wrap gap-x-1 gap-y-1.5">
          {shown.map(({ type, text }) => (
            <li key={`${type}:${text}`} className="flex max-w-full">
              <EntityChip type={type}>{text}</EntityChip>
            </li>
          ))}
        </ul>
      </section>
    </>
  )
}

type ResultProps = {
  transcription: Transcription
  editing: LineEditing
  confirm: Confirming
  signedIn: boolean
  onSelect: () => void
  onSignIn: () => void
  onAsk: () => void
}

export const Result = ({
  transcription,
  editing,
  confirm,
  signedIn,
  onSelect,
  onSignIn,
  onAsk,
}: ResultProps) => {
  const modern = modernLines(transcription)
  const warnings = transcription.warnings ?? []
  return (
    <>
      <EditAlert editing={editing} onSignIn={onSignIn} />
      <ConfirmAlert confirm={confirm} signedIn={signedIn} onSignIn={onSignIn} />
      {editing.editable &&
        !editing.editing &&
        !editing.problem &&
        !editing.waitingForSignIn &&
        !confirm.problem && (
          <VerifiedAlert
            transcription={transcription}
            confirm={confirm}
            onFix={() => {
              const first = transcription.lines[0]
              if (first) editing.open(first.idx)
            }}
          />
        )}
      <div className="flex-1 overflow-y-auto">
        {editing.editing ? (
          <EditingHint />
        ) : (
          <PageStatus
            transcription={transcription}
            disputed={editing.conflicts.map(({ idx }) => idx)}
          />
        )}
        {warnings.length > 0 && (
          <section className="p-3 pb-0">
            <Notes notes={warnings.map((warning) => strings.read.warnings[warning])} />
          </section>
        )}
        <section className="flex flex-col gap-1 p-3">
          <SectionLabel>{strings.read.transcriptionLines(transcription.lines.length)}</SectionLabel>
          <EditableLines
            editing={{
              ...editing,
              editable:
                editing.editable && !confirm.sending && confirm.problem?.kind !== 'conflict',
            }}
          />
        </section>
        {modern && !editing.unsaved && (
          <>
            <hr className="border-rule" />
            <ModernText lines={modern} expansions={transcription.expansions ?? []} />
          </>
        )}
        {!editing.unsaved && <Entities entities={transcription.entities} />}
      </div>
      <div className="relative">
        <div className="absolute inset-x-3 bottom-full z-10 -mb-[5px]">
          <ConflictCompare editing={editing} />
        </div>
        <ConfirmActions
          transcription={transcription}
          confirm={confirm}
          onSelect={onSelect}
          onAsk={onAsk}
        />
      </div>
    </>
  )
}

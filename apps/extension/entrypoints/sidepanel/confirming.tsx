import type { Transcription } from '@khronist/contracts'
import { ActionBar, Button, ConfirmDialog, PageStatusBadge, StatusBar, strings } from '@khronist/ui'
import { useEffect, useRef } from 'react'
import type { Confirming } from './useConfirm.ts'

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()

const verifierName = ({ verifiedBy, verifiedSignature }: Transcription) => {
  const name = verifiedBy?.name ?? ''
  const signature = verifiedSignature ?? ''
  if (name && signature && name !== signature) return strings.confirm.signedAs(name, signature)
  return name || signature
}

const verifierOf = (transcription: Transcription) =>
  verifierName(transcription) || strings.confirm.unsigned

const verifiedWhen = (verifiedAt: string | undefined, now: Date) => {
  if (!verifiedAt) return undefined
  const at = new Date(verifiedAt)
  return sameDay(at, now) ? strings.confirm.today : strings.confirm.date(at)
}

export const statusOf = (transcription: Transcription, now: Date) => {
  switch (transcription.status) {
    case 'draft':
      return { label: strings.confirm.draft, note: strings.confirm.nobodyYet }
    case 'verified':
      return {
        label: [
          strings.confirm.verified,
          verifierOf(transcription),
          verifiedWhen(transcription.verifiedAt, now),
        ]
          .filter(Boolean)
          .join(' · '),
        note: '',
      }
    case 'disputed':
      return { label: strings.confirm.disputed, note: '' }
  }
}

type PageStatusProps = { transcription: Transcription; disputed: number[] }

export const PageStatus = ({ transcription, disputed }: PageStatusProps) => {
  const shown =
    disputed.length > 0
      ? { status: 'disputed' as const, label: strings.edit.disputed(disputed), note: '' }
      : { status: transcription.status, ...statusOf(transcription, new Date()) }
  const { status, label, note } = shown
  return (
    <>
      <section className="flex items-center gap-2 p-3">
        <PageStatusBadge status={status}>{label}</PageStatusBadge>
        <p className="min-w-0 flex-1 text-right font-mono text-mono-10 text-ink-muted">{note}</p>
      </section>
      <hr className="border-rule" />
    </>
  )
}

type VerifiedAlertProps = { transcription: Transcription; confirm: Confirming; onFix: () => void }

export const VerifiedAlert = ({ transcription, confirm, onFix }: VerifiedAlertProps) => {
  const { status, verifiedAt, id } = transcription
  if (status !== 'verified' || !verifiedAt || confirm.confirmedHere.has(id)) return null
  return (
    <StatusBar
      type="success"
      message={strings.confirm.verifiedBy(
        verifierName(transcription),
        strings.confirm.date(new Date(verifiedAt)),
      )}
      action={strings.confirm.suggestFix}
      onAction={onFix}
    />
  )
}

type ConfirmAlertProps = { confirm: Confirming; signedIn: boolean; onSignIn: () => void }

export const ConfirmAlert = ({ confirm, signedIn, onSignIn }: ConfirmAlertProps) => {
  const { problem } = confirm
  if (problem?.kind === 'conflict')
    return (
      <StatusBar
        type="warning"
        message={strings.confirm.conflict}
        action={strings.edit.showCurrent}
        onAction={confirm.showCurrent}
      />
    )
  if (problem?.kind === 'signed-out' && !signedIn)
    return (
      <StatusBar
        type="info"
        message={strings.confirm.signInAgain}
        action={strings.account.signInLabel}
        onAction={onSignIn}
      />
    )
  if (problem?.kind === 'failed')
    return (
      <StatusBar
        type={problem.offline ? 'error' : 'warning'}
        message={problem.message}
        action={problem.retryable ? strings.read.retry : strings.account.dismiss}
        onAction={problem.retryable ? confirm.retry : confirm.dismiss}
      />
    )
  return null
}

type ConfirmActionsProps = {
  transcription: Transcription
  confirm: Confirming
  onSelect: () => void
}

const useFocusAfterConfirming = (busy: boolean) => {
  const trigger = useRef<HTMLButtonElement>(null)
  const select = useRef<HTMLButtonElement>(null)
  const wasBusy = useRef(busy)
  useEffect(() => {
    const done = wasBusy.current && !busy
    wasBusy.current = busy
    const lost = document.activeElement === null || document.activeElement === document.body
    if (done && lost) (trigger.current ?? select.current)?.focus()
  }, [busy])
  return { trigger, select }
}

export const ConfirmActions = ({ transcription, confirm, onSelect }: ConfirmActionsProps) => {
  const { trigger, select } = useFocusAfterConfirming(confirm.asking || confirm.sending)
  const verified = transcription.status === 'verified'
  const selectNext = () => {
    confirm.cancel()
    onSelect()
  }
  return (
    <div className="relative">
      {confirm.asking && (
        <div className="absolute inset-x-3 bottom-full z-10 -mb-[5px]">
          <ConfirmDialog
            title={strings.confirm.question(transcription.lines.length)}
            body={strings.confirm.licence(confirm.signature)}
            confirmLabel={strings.confirm.action}
            cancelLabel={strings.confirm.cancel}
            dontAskLabel={strings.confirm.dontAsk}
            dontAsk={confirm.ticked}
            busy={confirm.sending}
            onDontAskChange={confirm.tick}
            onConfirm={confirm.confirm}
            onCancel={confirm.cancel}
          />
        </div>
      )}
      <ActionBar>
        {confirm.available && (
          <Button
            ref={trigger}
            disabled={confirm.sending || confirm.asking}
            onClick={confirm.start}
          >
            {strings.confirm.action}
          </Button>
        )}
        <Button ref={select} kind={confirm.available ? 'ghost' : 'primary'} onClick={selectNext}>
          {verified ? strings.confirm.next : strings.read.selectFragment}
        </Button>
      </ActionBar>
    </div>
  )
}

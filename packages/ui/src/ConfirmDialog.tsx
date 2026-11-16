import { useId } from 'react'
import { Button } from './Button.tsx'

type ConfirmDialogProps = {
  title: string
  body: string
  confirmLabel: string
  cancelLabel: string
  dontAskLabel: string
  dontAsk: boolean
  busy?: boolean
  onDontAskChange: (dontAsk: boolean) => void
  onConfirm: () => void
  onCancel: () => void
}

export const ConfirmDialog = ({
  title,
  body,
  confirmLabel,
  cancelLabel,
  dontAskLabel,
  dontAsk,
  busy = false,
  onDontAskChange,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const titleId = useId()
  const bodyId = useId()
  return (
    <section
      role="group"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="flex flex-col gap-3 rounded-md border border-rule bg-base-200 p-4 shadow-[0_8px_24px_rgb(28_26_23/0.16)]"
    >
      <h2 id={titleId} className="text-heading-16">
        {title}
      </h2>
      <p id={bodyId} className="text-body-13 text-ink-muted">
        {body}
      </p>
      <label className="flex cursor-pointer items-center gap-2 text-body-13">
        <input
          type="checkbox"
          className="checkbox checkbox-primary size-4 rounded-[3px] border-rule checked:border-primary"
          checked={dontAsk}
          disabled={busy}
          onChange={(event) => onDontAskChange(event.target.checked)}
        />
        {dontAskLabel}
      </label>
      <div className="flex gap-2">
        <Button autoFocus disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
        <Button kind="ghost" disabled={busy} onClick={onCancel}>
          {cancelLabel}
        </Button>
      </div>
    </section>
  )
}

import { useId, useRef, type ReactNode } from 'react'
import { BottomSheet } from './BottomSheet.tsx'
import { Button } from './Button.tsx'

type ExplainSheetProps = {
  label: string
  title: string
  closeLabel: string
  alert?: ReactNode
  onClose: () => void
  children: ReactNode
}

export const ExplainSheet = ({
  label,
  title,
  closeLabel,
  alert,
  onClose,
  children,
}: ExplainSheetProps) => {
  const titleId = useId()
  const close = useRef<HTMLButtonElement>(null)

  return (
    <BottomSheet
      labelledBy={titleId}
      focusRef={close}
      alerting={alert !== undefined}
      onClose={onClose}
    >
      <div className="flex min-h-0 flex-col gap-2 overflow-y-auto px-3">
        <p className="text-label-section text-ink-muted uppercase">{label}</p>
        <h2 id={titleId} className="text-heading-20 break-words">
          {title}
        </h2>
        <div aria-live="polite" className="flex flex-col gap-2">
          {children}
        </div>
        {alert}
      </div>
      <div className="flex gap-2 px-3">
        <Button ref={close} kind="ghost" onClick={onClose}>
          {closeLabel}
        </Button>
      </div>
    </BottomSheet>
  )
}

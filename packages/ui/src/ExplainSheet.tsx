import { useEffect, useId, useLayoutEffect, useRef, type MouseEvent, type ReactNode } from 'react'
import { Button } from './Button.tsx'

type ExplainSheetProps = {
  label: string
  title: string
  closeLabel: string
  alert?: ReactNode
  onClose: () => void
  children: ReactNode
}

const useModal = (alerting: boolean) => {
  const sheet = useRef<HTMLDialogElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => {
    const dialog = sheet.current
    const opener = document.activeElement
    dialog?.showModal()
    close.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  useEffect(() => {
    if (!alerting && !sheet.current?.contains(document.activeElement)) close.current?.focus()
  }, [alerting])
  return { sheet, close }
}

const useBackdropClick = (onClose: () => void) => {
  const pressedOnBackdrop = useRef(false)
  const releasedOnBackdrop = useRef(false)
  const onBackdrop = (event: MouseEvent<HTMLDialogElement>) => event.target === event.currentTarget
  return {
    onPointerDown: (event: MouseEvent<HTMLDialogElement>) => {
      pressedOnBackdrop.current = onBackdrop(event)
    },
    onPointerUp: (event: MouseEvent<HTMLDialogElement>) => {
      releasedOnBackdrop.current = onBackdrop(event)
    },
    onClick: (event: MouseEvent<HTMLDialogElement>) => {
      const onlyBackdrop = pressedOnBackdrop.current && releasedOnBackdrop.current
      if (onlyBackdrop && onBackdrop(event) && event.detail <= 1) onClose()
    },
  }
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
  const { sheet, close } = useModal(alert !== undefined)
  const backdrop = useBackdropClick(onClose)

  return (
    <dialog
      ref={sheet}
      aria-labelledby={titleId}
      className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-full border-0 border-t border-rule bg-base-100 p-0 text-base-content backdrop:bg-base-content/20"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="flex max-h-[85dvh] flex-col gap-3 py-4">
        <span className="mx-auto h-[3px] w-8 shrink-0 rounded-sm bg-rule" aria-hidden />
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
      </div>
    </dialog>
  )
}

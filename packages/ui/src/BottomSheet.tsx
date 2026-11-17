import {
  useEffect,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react'

type BottomSheetProps = {
  labelledBy: string
  focusRef: RefObject<HTMLElement | null>
  alerting: boolean
  onClose: () => void
  children: ReactNode
}

const useModal = (focusRef: BottomSheetProps['focusRef'], alerting: boolean) => {
  const sheet = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const dialog = sheet.current
    const opener = document.activeElement
    dialog?.showModal()
    focusRef.current?.focus()
    return () => {
      if (dialog?.open) dialog.close()
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  useEffect(() => {
    if (!alerting && !sheet.current?.contains(document.activeElement)) focusRef.current?.focus()
  }, [alerting])
  return sheet
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

export const BottomSheet = ({
  labelledBy,
  focusRef,
  alerting,
  onClose,
  children,
}: BottomSheetProps) => {
  const sheet = useModal(focusRef, alerting)
  const backdrop = useBackdropClick(onClose)
  return (
    <dialog
      ref={sheet}
      aria-labelledby={labelledBy}
      className="fixed inset-x-0 top-auto bottom-0 m-0 w-full max-w-full border-0 border-t border-rule bg-base-100 p-0 text-base-content backdrop:bg-base-content/20"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      {...backdrop}
    >
      <div className="flex max-h-[85dvh] flex-col gap-3 py-4">
        <span className="mx-auto h-[3px] w-8 shrink-0 rounded-sm bg-rule" aria-hidden />
        {children}
      </div>
    </dialog>
  )
}

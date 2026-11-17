import { useEffect, useRef, type FocusEvent } from 'react'

export const useFocusFallback = (change: unknown) => {
  const region = useRef<HTMLElement>(null)
  const focusedInside = useRef(false)
  useEffect(() => {
    if (focusedInside.current && document.activeElement === document.body) region.current?.focus()
  }, [change])
  const onFocus = () => {
    focusedInside.current = true
  }
  const onBlur = (event: FocusEvent) => {
    const next = event.relatedTarget
    const leftToNothing = next === null && event.target.isConnected
    const leftOutside = next instanceof Node && !region.current?.contains(next)
    if (leftToNothing || leftOutside) focusedInside.current = false
  }
  return { region, onFocus, onBlur }
}

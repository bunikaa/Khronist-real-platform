import { useEffect, useState, type PointerEvent } from 'react'
import { strings } from './strings.uk.ts'

export type SelectionRect = {
  left: number
  top: number
  width: number
  height: number
}

type Point = { x: number; y: number }

type SelectionOverlayProps = {
  onSelect: (rect: SelectionRect) => void
  onCancel: () => void
}

const pointerPoint = (event: PointerEvent): Point => ({ x: event.clientX, y: event.clientY })

export const rectBetween = (a: Point, b: Point): SelectionRect => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
})

export const minSelectionSize = 24

export const isLargeEnough = (rect: SelectionRect): boolean =>
  rect.width >= minSelectionSize && rect.height >= minSelectionSize

export const SelectionOverlay = ({ onSelect, onCancel }: SelectionOverlayProps) => {
  const [start, setStart] = useState<Point>()
  const [rect, setRect] = useState<SelectionRect>()
  const [tooSmall, setTooSmall] = useState(false)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  const begin = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = pointerPoint(event)
    setTooSmall(false)
    setStart(point)
    setRect(rectBetween(point, point))
  }

  const move = (event: PointerEvent) => {
    if (start) setRect(rectBetween(start, pointerPoint(event)))
  }

  const finish = (event: PointerEvent) => {
    if (!start) return
    const selected = rectBetween(start, pointerPoint(event))
    setStart(undefined)
    setRect(undefined)
    if (isLargeEnough(selected)) onSelect(selected)
    else setTooSmall(true)
  }

  return (
    <div
      className="fixed inset-0 cursor-crosshair select-none"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={finish}
    >
      {rect && (
        <div
          className="absolute rounded-[2px] border-[1.25px] border-dashed border-primary bg-accent-soft"
          style={rect}
        />
      )}
      {tooSmall && (
        <p
          role="status"
          className="absolute top-4 left-1/2 -translate-x-1/2 rounded bg-neutral px-3 py-2 text-neutral-content"
        >
          {strings.read.selectionTooSmall}
        </p>
      )}
    </div>
  )
}

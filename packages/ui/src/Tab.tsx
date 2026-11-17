import type { KeyboardEvent, ReactNode } from 'react'

const keyMoves: Record<string, (index: number, count: number) => number> = {
  ArrowRight: (index, count) => (index + 1) % count,
  ArrowLeft: (index, count) => (index - 1 + count) % count,
  Home: () => 0,
  End: (_index, count) => count - 1,
}

const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
  const move = keyMoves[event.key]
  const tabs = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'),
  ]
  const index = tabs.findIndex((tab) => tab === event.target)
  if (!move || index === -1) return
  event.preventDefault()
  const next = tabs[move(index, tabs.length)]
  next?.focus()
  next?.click()
}

type TabListProps = {
  label: string
  children: ReactNode
}

export const TabList = ({ label, children }: TabListProps) => (
  <div
    role="tablist"
    aria-label={label}
    onKeyDown={moveFocus}
    className="flex h-[39px] shrink-0 gap-5 border-b border-rule bg-base-200 px-3"
  >
    {children}
  </div>
)

type TabProps = {
  id: string
  controls: string
  state: 'active' | 'inactive'
  disabled?: boolean
  children: string
  onSelect: () => void
}

export const Tab = ({ id, controls, state, disabled = false, children, onSelect }: TabProps) => (
  <button
    type="button"
    role="tab"
    id={id}
    aria-controls={controls}
    aria-selected={state === 'active'}
    tabIndex={state === 'active' ? 0 : -1}
    disabled={disabled}
    onClick={onSelect}
    className={`flex cursor-pointer flex-col gap-2 pt-2.5 text-label-13 disabled:cursor-default disabled:opacity-50 ${state === 'active' ? 'text-base-content' : 'text-ink-muted'}`}
  >
    {children}
    <span aria-hidden className={`h-0.5 w-full ${state === 'active' ? 'bg-primary' : ''}`} />
  </button>
)

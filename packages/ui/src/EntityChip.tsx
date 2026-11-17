import type { Entity } from '@khronist/contracts'
import { strings } from './strings.uk.ts'

type EntityChipProps = {
  type: Entity['type']
  state?: 'default' | 'active'
  onSelect?: () => void
  children: string
}

const tone = {
  default: 'border-rule',
  active: 'border-primary bg-accent-soft',
}

export const EntityChip = ({ type, state = 'default', onSelect, children }: EntityChipProps) => {
  const className = `inline-flex h-[22px] max-w-full items-center rounded-full border px-2 text-body-12 ${tone[state]}`
  const content = (
    <>
      <span className="sr-only">{strings.entity.type(type)}</span>
      <span className="truncate">{children}</span>
    </>
  )
  if (!onSelect)
    return (
      <span title={children} className={className}>
        {content}
      </span>
    )
  return (
    <button
      type="button"
      title={children}
      aria-haspopup="dialog"
      aria-expanded={state === 'active'}
      className={`${className} cursor-pointer`}
      onClick={onSelect}
    >
      {content}
    </button>
  )
}

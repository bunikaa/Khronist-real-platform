import type { Entity } from '@khronist/contracts'
import { strings } from './strings.uk.ts'

type EntityChipProps = {
  type: Entity['type']
  state?: 'default' | 'active'
  children: string
}

const tone = {
  default: 'border-rule',
  active: 'border-primary bg-accent-soft',
}

export const EntityChip = ({ type, state = 'default', children }: EntityChipProps) => (
  <span
    title={children}
    className={`inline-flex h-[22px] max-w-full items-center rounded-full border px-2 text-body-12 ${tone[state]}`}
  >
    <span className="sr-only">{strings.entity.type(type)}</span>
    <span className="truncate">{children}</span>
  </span>
)

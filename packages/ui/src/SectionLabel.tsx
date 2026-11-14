import type { ReactNode } from 'react'

type SectionLabelProps = {
  children: ReactNode
}

export const SectionLabel = ({ children }: SectionLabelProps) => (
  <h3 className="text-label-section text-ink-muted uppercase">{children}</h3>
)

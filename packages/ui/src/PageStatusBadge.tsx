import type { ReactNode } from 'react'

type PageStatusBadgeProps = {
  status: 'draft' | 'editing' | 'verified' | 'disputed'
  children: ReactNode
}

const tone = {
  draft: 'border-rule text-ink-muted',
  editing: 'border-primary text-primary',
  verified: 'border-success text-success',
  disputed: 'border-warning text-warning',
}

export const PageStatusBadge = ({ status, children }: PageStatusBadgeProps) => (
  <span
    className={`inline-flex h-5 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-mono-10 ${tone[status]}`}
  >
    <span className="size-1.5 rounded-full bg-current" aria-hidden />
    {children}
  </span>
)

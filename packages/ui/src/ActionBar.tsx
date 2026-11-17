import type { ReactNode } from 'react'

type ActionBarProps = {
  children: ReactNode
}

export const ActionBar = ({ children }: ActionBarProps) => (
  <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-t border-rule bg-base-100 px-3 py-2">
    {children}
  </div>
)

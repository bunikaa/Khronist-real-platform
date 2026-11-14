import type { ReactNode } from 'react'

type ActionBarProps = {
  children: ReactNode
}

export const ActionBar = ({ children }: ActionBarProps) => (
  <div className="flex h-12 shrink-0 items-center gap-2 border-t border-rule bg-base-100 px-3">
    {children}
  </div>
)

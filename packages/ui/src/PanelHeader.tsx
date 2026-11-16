import type { Shelfmark } from '@khronist/contracts'
import { User } from 'lucide-react'
import { strings } from './strings.uk.ts'

type PanelHeaderProps = {
  shelfmark?: Shelfmark
  account?: { label: string; open: boolean; onToggle: () => void }
}

export const PanelHeader = ({ shelfmark, account }: PanelHeaderProps) => (
  <header className="flex h-11 items-center gap-3 border-b border-rule bg-base-200 px-3">
    <span className="shrink-0 font-display text-brand-logo">{strings.brand}</span>
    {shelfmark && (
      <span className="flex min-w-0 flex-1 justify-end gap-1.5 font-mono text-mono-11 text-ink-muted">
        <span className="truncate">{strings.shelfmark.place(shelfmark)} ·</span>
        <span className="shrink-0">{strings.shelfmark.page(shelfmark)}</span>
      </span>
    )}
    {account && (
      <button
        type="button"
        aria-label={account.label}
        aria-pressed={account.open}
        onMouseDown={(event) => event.preventDefault()}
        onClick={account.onToggle}
        className={[
          'btn btn-square btn-ghost btn-xs ml-auto shrink-0',
          account.open && 'bg-base-300',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <User size={16} aria-hidden />
      </button>
    )}
  </header>
)

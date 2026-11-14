import { strings } from './strings.uk.ts'

export const PanelHeader = () => (
  <header className="flex h-11 items-center gap-3 border-b border-rule bg-base-200 px-3">
    <span className="font-display text-brand-logo">{strings.brand}</span>
  </header>
)

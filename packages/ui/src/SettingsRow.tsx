import { ChevronRight } from 'lucide-react'

type SettingsRowProps = {
  label: string
  value: string
  onSelect: () => void
  expanded?: boolean
  disabled?: boolean
}

export const SettingsRow = ({ label, value, onSelect, expanded, disabled }: SettingsRowProps) => (
  <button
    type="button"
    className="flex w-full cursor-pointer items-center gap-3 border-b border-rule py-2.5 text-left text-body-13 disabled:cursor-default disabled:opacity-60"
    aria-expanded={expanded}
    disabled={disabled}
    onClick={onSelect}
  >
    <span className="shrink-0 text-base-content">{label}</span>
    <span className="min-w-0 flex-1 truncate text-right text-ink-muted">{value}</span>
    <ChevronRight size={16} className="shrink-0 text-ink-muted" aria-hidden />
  </button>
)

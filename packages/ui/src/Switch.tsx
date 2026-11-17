type SwitchProps = {
  id?: string
  checked: boolean
  label: string
  disabled?: boolean
  onChange: (checked: boolean) => void
}

export const Switch = ({ id, checked, label, disabled = false, onChange }: SwitchProps) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className={`flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full px-0.5 disabled:cursor-not-allowed disabled:opacity-50 ${checked ? 'justify-end bg-primary' : 'justify-start bg-ink-muted'}`}
  >
    <span className="size-3 rounded-full bg-primary-content" />
  </button>
)

type SwitchProps = {
  checked: boolean
  label: string
  onChange: (checked: boolean) => void
}

export const Switch = ({ checked, label, onChange }: SwitchProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full px-0.5 ${checked ? 'justify-end bg-primary' : 'justify-start bg-ink-muted'}`}
  >
    <span className="size-3 rounded-full bg-primary-content" />
  </button>
)

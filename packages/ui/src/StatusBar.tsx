import { CircleAlert, CircleCheck, Info, WifiOff } from 'lucide-react'

type StatusBarProps = {
  type: 'info' | 'success' | 'warning' | 'error'
  message: string
  action: string
  onAction: () => void
}

const icons = {
  info: { Icon: Info, className: 'text-ink-muted' },
  success: { Icon: CircleCheck, className: 'text-success' },
  warning: { Icon: CircleAlert, className: 'text-warning' },
  error: { Icon: WifiOff, className: 'text-error' },
}

export const StatusBar = ({ type, message, action, onAction }: StatusBarProps) => {
  const { Icon, className } = icons[type]
  return (
    <div role="status" className="flex gap-2 bg-base-200 px-3 py-2">
      <Icon size={16} className={`mt-px shrink-0 ${className}`} aria-hidden />
      <p className="min-w-0 flex-1 text-body-12">{message}</p>
      <button type="button" className="shrink-0 text-label-13 text-primary" onClick={onAction}>
        {action}
      </button>
    </div>
  )
}

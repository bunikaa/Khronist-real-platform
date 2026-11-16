import { useId, type InputHTMLAttributes } from 'react'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
  invalid?: boolean
}

const stateClass = {
  valid:
    'border-rule focus:border-base-content focus:ring-[0.5px] focus:ring-inset focus:ring-base-content',
  invalid: 'border-error',
}

export const TextField = ({ label, invalid = false, className, ...input }: TextFieldProps) => {
  const id = useId()
  return (
    <div className={['flex flex-col gap-1', className].filter(Boolean).join(' ')}>
      <label htmlFor={id} className="text-label-13 text-base-content">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={invalid}
        className={[
          'h-8 w-full rounded-field border bg-base-100 px-3 text-body-13 text-base-content outline-none placeholder:text-ink-muted',
          stateClass[invalid ? 'invalid' : 'valid'],
        ].join(' ')}
        {...input}
      />
    </div>
  )
}

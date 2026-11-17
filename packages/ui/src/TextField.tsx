import { useId, type ComponentProps } from 'react'
import { fieldFocus, fieldFrame } from './field.ts'

type TextFieldProps = ComponentProps<'input'> & {
  label: string
  invalid?: boolean
}

const stateClass = {
  valid: fieldFocus,
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
          fieldFrame,
          'h-8 w-full px-3 text-body-13 text-base-content outline-none placeholder:text-ink-muted',
          stateClass[invalid ? 'invalid' : 'valid'],
        ].join(' ')}
        {...input}
      />
    </div>
  )
}

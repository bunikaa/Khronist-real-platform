import type { ComponentProps } from 'react'

type CheckboxProps = Omit<ComponentProps<'input'>, 'type'> & {
  label: string
}

export const Checkbox = ({ label, className, ...input }: CheckboxProps) => (
  <label
    className={['flex cursor-pointer items-center gap-2 text-body-13', className]
      .filter(Boolean)
      .join(' ')}
  >
    <input
      type="checkbox"
      className="checkbox checkbox-primary size-4 rounded-[3px] border-rule checked:border-primary"
      {...input}
    />
    {label}
  </label>
)

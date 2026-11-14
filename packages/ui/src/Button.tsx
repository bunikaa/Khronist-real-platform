import type { ButtonHTMLAttributes } from 'react'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'outline' | 'ghost'
  size?: 'sm' | 'md'
}

const kindClass = {
  primary: 'btn-primary',
  outline: 'btn-outline border-rule',
  ghost: 'btn-ghost',
}

const sizeClass = {
  sm: 'btn-sm h-7',
  md: 'h-9',
}

export const Button = ({
  kind = 'primary',
  size = 'sm',
  type = 'button',
  className,
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={['btn text-label-13', kindClass[kind], sizeClass[size], className]
      .filter(Boolean)
      .join(' ')}
    {...props}
  />
)

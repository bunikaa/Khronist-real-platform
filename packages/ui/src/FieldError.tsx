type FieldErrorProps = {
  id: string
  children: string
}

export const FieldError = ({ id, children }: FieldErrorProps) => (
  <p id={id} className="text-body-12 text-error">
    {children}
  </p>
)

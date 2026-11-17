import { Button, FieldError, TextField, strings } from '@khronist/ui'
import { useEffect, useId, useRef, type FormEvent, type RefObject } from 'react'
import type { InvalidField, SearchForm as Form } from './query.ts'
import { SearchFilters } from './SearchFilters.tsx'

type InputRef = RefObject<HTMLInputElement | null>

type SearchFormProps = {
  form: Form
  queryRef: InputRef
  invalid: InvalidField[]
  onChange: (form: Form) => void
  onVerifiedOnlyChange: (verifiedOnly: boolean) => void
  onSubmit: (form: Form) => void
}

const text = strings.web

const queryErrorOf = (invalid: InvalidField[]) =>
  invalid.includes('q') ? text.queryInvalid : invalid.includes('words') ? text.queryNoWords : ''

const useFocusFirstInvalid = (invalid: InvalidField[], queryRef: InputRef, form: Form) => {
  const yearFromRef = useRef<HTMLInputElement>(null)
  const yearToRef = useRef<HTMLInputElement>(null)
  const checked = useRef(false)
  useEffect(() => {
    if (!checked.current) return
    checked.current = false
    const yearRef = form.yearFrom.trim() ? yearFromRef : yearToRef
    if (invalid.includes('q') || invalid.includes('words')) queryRef.current?.focus()
    else if (invalid.includes('years')) yearRef.current?.focus()
  }, [invalid])
  const markChecked = () => {
    checked.current = true
  }
  return { yearFromRef, yearToRef, markChecked }
}

export const SearchForm = (props: SearchFormProps) => {
  const { form, queryRef, invalid, onChange, onVerifiedOnlyChange, onSubmit } = props
  const queryErrorId = useId()
  const queryError = queryErrorOf(invalid)
  const { yearFromRef, yearToRef, markChecked } = useFocusFirstInvalid(invalid, queryRef, form)
  const submit = (event: FormEvent) => {
    event.preventDefault()
    markChecked()
    onSubmit(form)
  }
  return (
    <form role="search" className="flex flex-col gap-3" onSubmit={submit}>
      <div className="flex items-end gap-2">
        <TextField
          ref={queryRef}
          className="min-w-0 flex-1"
          label={text.query}
          enterKeyHint="search"
          placeholder={text.queryPlaceholder}
          invalid={queryError !== ''}
          aria-describedby={queryError ? queryErrorId : undefined}
          value={form.q}
          onChange={(event) => onChange({ ...form, q: event.target.value })}
        />
        <Button type="submit" size="md" className="px-4">
          {text.search}
        </Button>
      </div>
      {queryError && <FieldError id={queryErrorId}>{queryError}</FieldError>}
      <SearchFilters
        form={form}
        yearRefs={{ yearFrom: yearFromRef, yearTo: yearToRef }}
        yearsInvalid={invalid.includes('years')}
        onChange={(key, value) => onChange({ ...form, [key]: value })}
        onVerifiedOnlyChange={onVerifiedOnlyChange}
      />
    </form>
  )
}

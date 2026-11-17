import { Checkbox, FieldError, TextField, strings } from '@khronist/ui'
import { useId, type Ref } from 'react'
import type { SearchForm } from './query.ts'

type TextKey = Exclude<keyof SearchForm, 'verifiedOnly' | 'q'>

type SearchFiltersProps = {
  form: SearchForm
  yearRefs: { yearFrom: Ref<HTMLInputElement>; yearTo: Ref<HTMLInputElement> }
  yearsInvalid: boolean
  onChange: (field: TextKey, value: string) => void
  onVerifiedOnlyChange: (verifiedOnly: boolean) => void
}

type FieldOptions = { placeholder?: string; yearRef?: Ref<HTMLInputElement>; className?: string }

const text = strings.web

export const SearchFilters = (props: SearchFiltersProps) => {
  const { form, yearRefs, yearsInvalid, onChange, onVerifiedOnlyChange } = props
  const yearsErrorId = useId()
  const field = (key: TextKey, { placeholder, yearRef, className }: FieldOptions) => {
    const years = yearRef !== undefined
    return (
      <TextField
        ref={yearRef}
        className={className}
        label={text[key]}
        placeholder={placeholder}
        inputMode={years ? 'numeric' : undefined}
        maxLength={years ? 4 : undefined}
        invalid={years && yearsInvalid}
        aria-describedby={years && yearsInvalid ? yearsErrorId : undefined}
        value={form[key]}
        onChange={(event) => onChange(key, event.target.value)}
      />
    )
  }
  return (
    <>
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_6rem_auto] lg:items-end">
        {field('archive', {
          placeholder: text.archivePlaceholder,
          className: 'col-span-3 sm:col-span-1',
        })}
        {field('fond', { placeholder: text.fondPlaceholder })}
        {field('yearFrom', { yearRef: yearRefs.yearFrom })}
        {field('yearTo', { yearRef: yearRefs.yearTo })}
        <Checkbox
          className="col-span-3 h-8 sm:col-span-4 lg:col-span-1"
          label={text.verifiedOnly}
          checked={form.verifiedOnly}
          onChange={(event) => onVerifiedOnlyChange(event.target.checked)}
        />
      </div>
      {yearsInvalid && <FieldError id={yearsErrorId}>{text.yearsInvalid}</FieldError>}
    </>
  )
}

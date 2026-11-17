import { searchQuerySchema } from '@khronist/contracts'
import { significantWords } from './words.ts'

export type SearchForm = {
  q: string
  archive: string
  fond: string
  yearFrom: string
  yearTo: string
  verifiedOnly: boolean
}

export type InvalidField = 'q' | 'words' | 'years'

type ParsedForm = { params: URLSearchParams } | { invalid: InvalidField[] }

const filterKeys = ['archive', 'fond', 'yearFrom', 'yearTo'] as const

const filled = (value: string) => value.trim() || undefined

const rawQueryOf = (form: SearchForm) => ({
  q: form.q.trim(),
  archive: filled(form.archive),
  fond: filled(form.fond),
  yearFrom: filled(form.yearFrom),
  yearTo: filled(form.yearTo),
  verifiedOnly: String(form.verifiedOnly),
})

const yearsInOrder = (yearFrom: string | undefined, yearTo: string | undefined) =>
  yearFrom === undefined || yearTo === undefined || Number(yearFrom) <= Number(yearTo)

const invalidFieldsOf = (raw: ReturnType<typeof rawQueryOf>): InvalidField[] => {
  const parsed = searchQuerySchema.safeParse(raw)
  const failed = new Set(parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[0]))
  const invalid: InvalidField[] = []
  if (failed.has('q')) invalid.push('q')
  else if (significantWords(raw.q).length === 0) invalid.push('words')
  const yearsValid = !failed.has('yearFrom') && !failed.has('yearTo')
  if (!yearsValid || !yearsInOrder(raw.yearFrom, raw.yearTo)) invalid.push('years')
  return invalid
}

export const parseSearchForm = (form: SearchForm): ParsedForm => {
  const raw = rawQueryOf(form)
  const invalid = invalidFieldsOf(raw)
  if (invalid.length > 0) return { invalid }
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) if (value !== undefined) params.set(key, value)
  return { params }
}

const verifiedOnlyOf = (value: string | null) =>
  searchQuerySchema.shape.verifiedOnly.safeParse(value ?? undefined).data ?? true

export const searchFormOf = (params: URLSearchParams): SearchForm => ({
  q: params.get('q') ?? '',
  archive: params.get('archive') ?? '',
  fond: params.get('fond') ?? '',
  yearFrom: params.get('yearFrom') ?? '',
  yearTo: params.get('yearTo') ?? '',
  verifiedOnly: verifiedOnlyOf(params.get('verifiedOnly')),
})

export const withVerifiedOnly = (params: URLSearchParams, verifiedOnly: boolean) => {
  const changed = new URLSearchParams(params)
  changed.set('verifiedOnly', String(verifiedOnly))
  return changed
}

export const hasFilters = (params: URLSearchParams): boolean =>
  filterKeys.some((key) => params.has(key))

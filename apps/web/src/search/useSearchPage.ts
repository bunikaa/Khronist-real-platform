import { useEffect, useState } from 'react'
import {
  parseSearchForm,
  searchFormOf,
  withVerifiedOnly,
  type InvalidField,
  type SearchForm,
} from './query.ts'
import { useSearch } from './useSearch.ts'

const formInAddress = () => searchFormOf(new URLSearchParams(window.location.search))

export const useSearchPage = () => {
  const [initial] = useState(formInAddress)
  const [form, setForm] = useState(initial)
  const [invalid, setInvalid] = useState<InvalidField[]>([])
  const { state, search, showMore, searched } = useSearch()

  const run = (params: URLSearchParams) => {
    setForm(searchFormOf(params))
    setInvalid([])
    window.history.replaceState(null, '', `?${params}`)
    void search(params)
  }

  const submit = (next: SearchForm) => {
    const parsed = parseSearchForm(next)
    if ('params' in parsed) return run(parsed.params)
    setForm(next)
    setInvalid(parsed.invalid)
  }

  const setVerifiedOnly = (verifiedOnly: boolean) => {
    const last = searched()
    if (last) run(withVerifiedOnly(last, verifiedOnly))
    else setForm((previous) => ({ ...previous, verifiedOnly }))
  }

  const restart = () => {
    const last = searched()
    if (last) run(last)
  }

  const [searchesOnOpen] = useState(
    () => initial.q.trim() !== '' && 'params' in parseSearchForm(initial),
  )

  useEffect(() => {
    if (initial.q.trim()) submit(initial)
  }, [])

  const showsRecent = state.phase === 'idle' && !searchesOnOpen

  return { form, invalid, state, showsRecent, setForm, submit, setVerifiedOnly, showMore, restart }
}

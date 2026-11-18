import type { SearchResponse } from '@khronist/contracts'
import { useEffect, useRef, useState } from 'react'
import { loadSearchPage, type PageLoader, type SearchProblem } from '../api/search.ts'
import { hasFilters } from './query.ts'

export type SearchItem = SearchResponse['items'][number]

type MoreState =
  { phase: 'idle' } | { phase: 'loading' } | { phase: 'failed'; problem: SearchProblem }

export type SearchState =
  | { phase: 'idle' }
  | { phase: 'searching' }
  | { phase: 'failed'; problem: SearchProblem }
  | {
      phase: 'found'
      query: string
      verifiedOnly: boolean
      filtered: boolean
      items: SearchItem[]
      nextCursor: string | undefined
      more: MoreState
    }

type CurrentSearch = { params: URLSearchParams; controller: AbortController }

const foundState = (params: URLSearchParams, page: SearchResponse): SearchState => ({
  phase: 'found',
  query: params.get('q') ?? '',
  verifiedOnly: params.get('verifiedOnly') === 'true',
  filtered: hasFilters(params),
  items: page.items,
  nextCursor: page.nextCursor,
  more: { phase: 'idle' },
})

const withNewItems = (shown: SearchItem[], page: SearchItem[]) => {
  const ids = new Set(shown.map((item) => item.transcriptionId))
  return [...shown, ...page.filter((item) => !ids.has(item.transcriptionId))]
}

export const useSearch = (loadPage: PageLoader = loadSearchPage) => {
  const [state, setState] = useState<SearchState>({ phase: 'idle' })
  const current = useRef<CurrentSearch | undefined>(undefined)

  useEffect(() => () => current.current?.controller.abort(), [])

  const search = async (params: URLSearchParams) => {
    current.current?.controller.abort()
    const controller = new AbortController()
    current.current = { params, controller }
    setState({ phase: 'searching' })
    const outcome = await loadPage(params, undefined, controller.signal)
    if (controller.signal.aborted) return
    setState(
      outcome.ok ? foundState(params, outcome.page) : { phase: 'failed', problem: outcome.problem },
    )
  }

  const showMore = async () => {
    if (state.phase !== 'found' || state.nextCursor === undefined || !current.current) return
    if (state.more.phase === 'loading') return
    const { params, controller } = current.current
    setState({ ...state, more: { phase: 'loading' } })
    const outcome = await loadPage(params, state.nextCursor, controller.signal)
    if (controller.signal.aborted) return
    setState((previous) => {
      if (previous.phase !== 'found') return previous
      if (!outcome.ok) return { ...previous, more: { phase: 'failed', problem: outcome.problem } }
      const { items, nextCursor } = outcome.page
      return {
        ...previous,
        items: withNewItems(previous.items, items),
        nextCursor,
        more: { phase: 'idle' },
      }
    })
  }

  const searched = () => current.current?.params

  return { state, search, showMore, searched }
}

import { strings } from '@khronist/ui'
import { useEffect, useState } from 'react'
import { loadRecentPage } from '../api/search.ts'
import { ProblemBar } from './ProblemBar.tsx'
import { ResultList } from './ResultList.tsx'
import { useFocusFallback } from './useFocusFallback.ts'
import { useSearch } from './useSearch.ts'

const text = strings.web

const firstPage = () => new URLSearchParams()

export const RecentFeed = () => {
  const { state, search, showMore } = useSearch(loadRecentPage)
  const [retried, setRetried] = useState(false)
  const { region, onFocus, onBlur } = useFocusFallback(state)

  useEffect(() => void search(firstPage()), [])

  const retry = () => {
    setRetried(true)
    void search(firstPage())
  }

  const hasRecords = state.phase === 'found' && state.items.length > 0
  const retrying = state.phase === 'searching' && retried
  if (!hasRecords && !retrying && state.phase !== 'failed') return null
  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-labelledby="recent-title"
      className="flex flex-col gap-2 outline-none"
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <h2 id="recent-title" className="text-heading-16">
        {text.recent}
      </h2>
      <p className="text-body-13 text-ink-muted">{text.recentHint}</p>
      {retrying && <p className="py-4 text-body-13 text-ink-muted">{text.loadingMore}</p>}
      {state.phase === 'failed' && (
        <ProblemBar
          problem={state.problem}
          onRetry={retry}
          whenRejected={{ action: text.retry, onAction: retry }}
        />
      )}
      {state.phase === 'found' && (
        <ResultList
          state={state}
          onShowMore={() => void showMore()}
          whenRejected={{ action: text.retry, onAction: retry }}
        />
      )}
    </section>
  )
}

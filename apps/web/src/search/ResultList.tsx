import { Button, strings } from '@khronist/ui'
import { useEffect, useMemo, useRef } from 'react'
import { ProblemBar } from './ProblemBar.tsx'
import { ResultItem } from './ResultItem.tsx'
import type { SearchState } from './useSearch.ts'
import { significantWords } from './words.ts'

type ResultListProps = {
  state: Extract<SearchState, { phase: 'found' }>
  onShowMore: () => void
  whenRejected: { action: string; onAction: () => void }
}

const useFocusAfterMore = (count: number, morePhase: string) => {
  const list = useRef<HTMLUListElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const shown = useRef(count)
  useEffect(() => {
    const firstNew = list.current?.children[shown.current]
    const active = document.activeElement
    const onMore = active === document.body || active === moreButton.current
    if (count > shown.current && onMore && firstNew instanceof HTMLElement) firstNew.focus()
    shown.current = count
  }, [count])
  useEffect(() => {
    if (morePhase !== 'idle' && document.activeElement === document.body)
      moreButton.current?.focus()
  }, [morePhase])
  return { list, moreButton }
}

export const ResultList = ({ state, onShowMore, whenRejected }: ResultListProps) => {
  const { items, more, nextCursor } = state
  const { list, moreButton } = useFocusAfterMore(items.length, more.phase)
  const words = useMemo(() => significantWords(state.query), [state.query])
  const loading = more.phase === 'loading'
  return (
    <div className="flex flex-col gap-4">
      <ul ref={list} className="flex flex-col">
        {items.map((item) => (
          <ResultItem key={item.transcriptionId} item={item} words={words} />
        ))}
      </ul>
      {more.phase === 'failed' && (
        <ProblemBar problem={more.problem} onRetry={onShowMore} whenRejected={whenRejected} />
      )}
      {nextCursor !== undefined && more.phase !== 'failed' && (
        <Button
          ref={moreButton}
          kind="outline"
          size="md"
          className="self-center px-4"
          aria-disabled={loading}
          onClick={onShowMore}
        >
          {loading ? strings.web.loadingMore : strings.web.more}
        </Button>
      )}
    </div>
  )
}

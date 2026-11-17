import { Button, strings } from '@khronist/ui'
import { ProblemBar } from './ProblemBar.tsx'
import { ResultList } from './ResultList.tsx'
import { useFocusFallback } from './useFocusFallback.ts'
import type { SearchState } from './useSearch.ts'

const text = strings.web

type NothingProps = { verifiedOnly: boolean; filtered: boolean; onIncludeDrafts: () => void }

const Nothing = ({ verifiedOnly, filtered, onIncludeDrafts }: NothingProps) => (
  <div className="flex flex-col items-center gap-3 px-3 py-8 text-center">
    <h2 className="text-heading-16">{text.nothing}</h2>
    <p className="max-w-md text-body-13 text-ink-muted">
      {verifiedOnly ? text.nothingVerified : filtered ? text.nothingFiltered : text.nothingHint}
    </p>
    {verifiedOnly && (
      <Button kind="outline" onClick={onIncludeDrafts}>
        {text.includeDrafts}
      </Button>
    )}
  </div>
)

type SearchResultsProps = {
  state: SearchState
  onRestart: () => void
  onEditQuery: () => void
  onShowMore: () => void
  onIncludeDrafts: () => void
}

const Outcome = ({
  state,
  onRestart,
  onEditQuery,
  onShowMore,
  onIncludeDrafts,
}: SearchResultsProps) => {
  if (state.phase === 'idle') return null
  if (state.phase === 'searching')
    return <p className="py-8 text-center text-body-13 text-ink-muted">{text.searching}</p>
  if (state.phase === 'failed') {
    const whenRejected = { action: text.editQuery, onAction: onEditQuery }
    return <ProblemBar problem={state.problem} onRetry={onRestart} whenRejected={whenRejected} />
  }
  if (state.items.length === 0)
    return (
      <Nothing
        verifiedOnly={state.verifiedOnly}
        filtered={state.filtered}
        onIncludeDrafts={onIncludeDrafts}
      />
    )
  return <ResultList state={state} onShowMore={onShowMore} onRestart={onRestart} />
}

export const SearchResults = (props: SearchResultsProps) => {
  const { region, onFocus, onBlur } = useFocusFallback(props.state)
  return (
    <section
      ref={region}
      tabIndex={-1}
      aria-label={text.results}
      className="flex flex-col outline-none"
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <Outcome {...props} />
    </section>
  )
}

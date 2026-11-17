import { PageStatusBadge, strings } from '@khronist/ui'
import { memo } from 'react'
import { highlightSnippet } from './highlight.ts'
import type { SearchItem } from './useSearch.ts'

const statusLabel = {
  draft: strings.confirm.draft,
  verified: strings.confirm.verified,
  disputed: strings.confirm.disputed,
}

type ResultItemProps = {
  item: SearchItem
  words: string[]
}

const Snippet = ({ snippet, words }: { snippet: string; words: string[] }) => (
  <p className="text-body-14 [overflow-wrap:anywhere]">
    {highlightSnippet(snippet, words).map((part, index) =>
      part.match ? (
        <mark key={index} className="rounded-[2px] bg-accent-soft text-base-content">
          {part.text}
        </mark>
      ) : (
        part.text
      ),
    )}
  </p>
)

const ResultItemView = ({ item, words }: ResultItemProps) => {
  const { shelfmark, yearFrom, yearTo, snippet, status, portalUrl } = item
  return (
    <li tabIndex={-1} className="flex flex-col gap-2 border-b border-rule py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 font-mono text-mono-11 text-ink-muted [overflow-wrap:anywhere]">
          {strings.shelfmark.place(shelfmark)} · {strings.shelfmark.page(shelfmark)}
          {(yearFrom ?? yearTo) !== undefined && ` · ${strings.web.years(yearFrom, yearTo)}`}
        </p>
        <PageStatusBadge status={status}>{statusLabel[status]}</PageStatusBadge>
      </div>
      {snippet.trim() && <Snippet snippet={snippet} words={words} />}
      {portalUrl && (
        <a
          href={portalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start text-label-13 text-primary hover:underline"
        >
          {strings.web.openPortal}
        </a>
      )}
    </li>
  )
}

export const ResultItem = memo(ResultItemView)

import { PanelHeader, strings } from '@khronist/ui'
import { useRef } from 'react'
import { announcementOf } from './search/messages.ts'
import { RecentFeed } from './search/RecentFeed.tsx'
import { SearchForm } from './search/SearchForm.tsx'
import { SearchResults } from './search/SearchResults.tsx'
import { useSearchPage } from './search/useSearchPage.ts'

export const App = () => {
  const page = useSearchPage()
  const queryInput = useRef<HTMLInputElement>(null)
  return (
    <div className="flex min-h-dvh flex-col">
      <PanelHeader />
      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 py-8">
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-brand-display">{strings.web.title}</h1>
          <p className="max-w-2xl text-body-13 text-ink-muted">{strings.web.intro}</p>
        </header>
        <SearchForm
          form={page.form}
          queryRef={queryInput}
          invalid={page.invalid}
          onChange={page.setForm}
          onVerifiedOnlyChange={page.setVerifiedOnly}
          onSubmit={page.submit}
        />
        <p role="status" className="sr-only">
          {announcementOf(page.state)}
        </p>
        <SearchResults
          state={page.state}
          onRestart={page.restart}
          onEditQuery={() => queryInput.current?.focus()}
          onShowMore={() => void page.showMore()}
          onIncludeDrafts={() => page.setVerifiedOnly(false)}
        />
        {page.showsRecent && <RecentFeed />}
      </main>
    </div>
  )
}

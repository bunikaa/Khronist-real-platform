import { ActionBar, Button, PanelHeader, strings } from '@khronist/ui'
import { Crosshair } from 'lucide-react'
import { useEffect } from 'react'
import { browser } from 'wxt/browser'
import type { SelectionCommand } from '../../messages.ts'
import { activeTabId, useActivePage } from './useActivePage.ts'

const sendToActiveTab = async (command: SelectionCommand) => {
  const tabId = await activeTabId()
  if (tabId !== undefined) await browser.tabs.sendMessage(tabId, command).catch(() => undefined)
}

const startSelection = () => void sendToActiveTab({ type: 'start-selection' })
const cancelSelection = () => void sendToActiveTab({ type: 'cancel-selection' })

const ReadyToRead = () => (
  <>
    <main className="flex-1 overflow-y-auto">
      <section className="flex flex-col items-center gap-3 px-3 py-8 text-center">
        <Crosshair
          size={32}
          strokeWidth={4 / 3}
          absoluteStrokeWidth
          className="text-ink-muted"
          aria-hidden
        />
        <h2 className="text-heading-16">{strings.read.promptTitle}</h2>
        <p className="text-body-13 text-ink-muted">{strings.read.promptBody}</p>
      </section>
    </main>
    <ActionBar>
      <Button onClick={startSelection}>{strings.read.selectFragment}</Button>
    </ActionBar>
  </>
)

const Selecting = () => (
  <>
    <main className="flex-1 overflow-y-auto">
      <section className="flex flex-col items-center gap-3 px-3 py-8 text-center opacity-50">
        <h2 className="text-heading-16">{strings.read.selectingTitle}</h2>
        <p className="font-mono text-mono-11 text-ink-muted">{strings.read.selectingHint}</p>
      </section>
    </main>
    <ActionBar>
      <Button kind="ghost" onClick={cancelSelection}>
        {strings.read.cancel}
      </Button>
    </ActionBar>
  </>
)

export const App = () => {
  const page = useActivePage()

  useEffect(() => {
    const onCommand = (command: string) => {
      if (command === 'open-panel') startSelection()
    }
    browser.commands.onCommand.addListener(onCommand)
    return () => browser.commands.onCommand.removeListener(onCommand)
  }, [])

  return (
    <div className="flex h-screen flex-col">
      <PanelHeader shelfmark={page?.shelfmark ?? undefined} />
      {page?.shelfmark && (page.selecting ? <Selecting /> : <ReadyToRead />)}
    </div>
  )
}

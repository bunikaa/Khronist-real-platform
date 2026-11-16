import { PanelHeader } from '@khronist/ui'
import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import {
  fragmentFailedMessageSchema,
  fragmentMessageSchema,
  type SelectionCommand,
} from '../../messages.ts'
import { Failed, MissingPage, Reading, ReadyToRead, Result, Selecting } from './screens.tsx'
import { activeTabId, useActivePage } from './useActivePage.ts'
import { useReading } from './useReading.ts'

const sendToActiveTab = async (command: SelectionCommand) => {
  const tabId = await activeTabId()
  if (tabId !== undefined) await browser.tabs.sendMessage(tabId, command).catch(() => undefined)
}

const startSelection = () => void sendToActiveTab({ type: 'start-selection' })
const cancelSelection = () => void sendToActiveTab({ type: 'cancel-selection' })

const useShortcut = () => {
  const [shortcut, setShortcut] = useState<string>()
  useEffect(() => {
    browser.commands.getAll().then(
      (commands) => {
        const assigned = commands.find((command) => command.name === 'open-panel')?.shortcut
        setShortcut(assigned || undefined)
      },
      () => setShortcut(undefined),
    )
  }, [])
  return shortcut
}

export const App = () => {
  const page = useActivePage()
  const shortcut = useShortcut()
  const { reading, start, retry, failSelection, cancel } = useReading()
  const selecting = page?.selecting === true

  useEffect(() => {
    const onCommand = (command: string, tab?: { id?: number }) => {
      if (command !== 'open-panel') return
      void activeTabId().then((tabId) => {
        if (tab?.id === undefined || tab.id !== tabId) return
        startSelection()
      })
    }
    const onMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
      const fragment = fragmentMessageSchema.safeParse(message)
      const failed = fragmentFailedMessageSchema.safeParse(message)
      if (!fragment.success && !failed.success) return
      void activeTabId().then((tabId) => {
        if (sender.tab?.id !== tabId) return
        if (fragment.success) start(fragment.data.fragment, fragment.data.shelfmark)
        if (failed.success) failSelection(failed.data.reason, failed.data.shelfmark)
      })
    }
    browser.commands.onCommand.addListener(onCommand)
    browser.runtime.onMessage.addListener(onMessage)
    return () => {
      browser.commands.onCommand.removeListener(onCommand)
      browser.runtime.onMessage.removeListener(onMessage)
    }
  }, [start, failSelection])

  useEffect(() => {
    if (!selecting) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelSelection()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selecting])

  const screen = () => {
    if (selecting) return <Selecting onCancel={cancelSelection} />
    switch (reading.phase) {
      case 'idle':
        if (page === undefined) return null
        if (!page?.scan) return <MissingPage />
        return <ReadyToRead onSelect={startSelection} shortcut={shortcut} />
      case 'reading':
        return <Reading {...reading} onCancel={cancel} />
      case 'done':
        return <Result transcription={reading.transcription} onSelect={startSelection} />
      case 'failed':
        return <Failed {...reading} onSelect={startSelection} onRetry={retry} />
    }
  }

  const shelfmark = reading.phase === 'idle' ? page?.shelfmark : reading.shelfmark

  return (
    <div className="flex h-screen flex-col">
      <PanelHeader shelfmark={shelfmark ?? undefined} />
      {screen()}
    </div>
  )
}

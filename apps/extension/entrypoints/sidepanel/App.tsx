import { PanelHeader } from '@khronist/ui'
import { useEffect } from 'react'
import { browser } from 'wxt/browser'
import { fragmentMessageSchema, type SelectionCommand } from '../../messages.ts'
import { Failed, Reading, ReadyToRead, Result, Selecting } from './screens.tsx'
import { activeTabId, useActivePage } from './useActivePage.ts'
import { useReading } from './useReading.ts'

const sendToActiveTab = async (command: SelectionCommand) => {
  const tabId = await activeTabId()
  if (tabId !== undefined) await browser.tabs.sendMessage(tabId, command).catch(() => undefined)
}

const startSelection = () => void sendToActiveTab({ type: 'start-selection' })
const cancelSelection = () => void sendToActiveTab({ type: 'cancel-selection' })

export const App = () => {
  const page = useActivePage()
  const { reading, start, cancel } = useReading()

  useEffect(() => {
    const onCommand = (command: string) => {
      if (command === 'open-panel') startSelection()
    }
    const onMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
      const parsed = fragmentMessageSchema.safeParse(message)
      if (!parsed.success) return
      void activeTabId().then((tabId) => {
        if (sender.tab?.id === tabId) start(parsed.data.fragment, parsed.data.shelfmark)
      })
    }
    browser.commands.onCommand.addListener(onCommand)
    browser.runtime.onMessage.addListener(onMessage)
    return () => {
      browser.commands.onCommand.removeListener(onCommand)
      browser.runtime.onMessage.removeListener(onMessage)
    }
  }, [start])

  const screen = () => {
    if (page?.selecting) return <Selecting onCancel={cancelSelection} />
    switch (reading.phase) {
      case 'idle':
        return <ReadyToRead onSelect={startSelection} />
      case 'reading':
        return <Reading {...reading} onCancel={cancel} />
      case 'done':
        return <Result transcription={reading.transcription} onSelect={startSelection} />
      case 'failed':
        return <Failed {...reading} onSelect={startSelection} />
    }
  }

  return (
    <div className="flex h-screen flex-col">
      <PanelHeader shelfmark={page?.shelfmark ?? undefined} />
      {page?.shelfmark && screen()}
    </div>
  )
}

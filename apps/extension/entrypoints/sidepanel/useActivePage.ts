import type { Shelfmark } from '@khronist/contracts'
import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { pageMessageSchema } from '../../messages.ts'

const activeTabId = async (): Promise<number | undefined> => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

const askPage = async (tabId: number): Promise<Shelfmark | null> => {
  try {
    const parsed = pageMessageSchema.safeParse(
      await browser.tabs.sendMessage(tabId, { type: 'get-page' }),
    )
    return parsed.success ? parsed.data.shelfmark : null
  } catch {
    return null
  }
}

export const useActivePage = (): Shelfmark | null => {
  const [shelfmark, setShelfmark] = useState<Shelfmark | null>(null)

  useEffect(() => {
    let tabId: number | undefined
    let disposed = false

    const refresh = async () => {
      tabId = await activeTabId()
      const next = tabId === undefined ? null : await askPage(tabId)
      if (!disposed) setShelfmark(next)
    }

    const onMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
      const parsed = pageMessageSchema.safeParse(message)
      if (parsed.success && sender.tab?.id === tabId) setShelfmark(parsed.data.shelfmark)
    }
    const onUpdated = (updatedTabId: number, change: { status?: string }) => {
      if (updatedTabId === tabId && change.status === 'complete') void refresh()
    }
    const onActivated = () => void refresh()

    browser.runtime.onMessage.addListener(onMessage)
    browser.tabs.onActivated.addListener(onActivated)
    browser.tabs.onUpdated.addListener(onUpdated)
    void refresh()

    return () => {
      disposed = true
      browser.runtime.onMessage.removeListener(onMessage)
      browser.tabs.onActivated.removeListener(onActivated)
      browser.tabs.onUpdated.removeListener(onUpdated)
    }
  }, [])

  return shelfmark
}

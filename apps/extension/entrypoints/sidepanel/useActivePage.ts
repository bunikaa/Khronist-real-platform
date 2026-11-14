import { useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { pageMessageSchema, type PageMessage } from '../../messages.ts'

export const activeTabId = async (): Promise<number | undefined> => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  return tab?.id
}

const askPage = async (tabId: number): Promise<PageMessage | null> => {
  try {
    const parsed = pageMessageSchema.safeParse(
      await browser.tabs.sendMessage(tabId, { type: 'get-page' }),
    )
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export const useActivePage = (): PageMessage | null => {
  const [page, setPage] = useState<PageMessage | null>(null)

  useEffect(() => {
    let tabId: number | undefined
    let disposed = false

    const refresh = async () => {
      tabId = await activeTabId()
      const next = tabId === undefined ? null : await askPage(tabId)
      if (!disposed) setPage(next)
    }

    const onMessage = (message: unknown, sender: { tab?: { id?: number } }) => {
      const parsed = pageMessageSchema.safeParse(message)
      if (parsed.success && sender.tab?.id === tabId) setPage(parsed.data)
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

  return page
}

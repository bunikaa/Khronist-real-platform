import { browser } from 'wxt/browser'
import { defineContentScript } from 'wxt/utils/define-content-script'
import { pageRequestSchema, type PageMessage } from '../messages.ts'
import { archiumMatches, readArchiumShelfmark } from '../portal/archium.ts'

export default defineContentScript({
  matches: archiumMatches,
  main(ctx) {
    const currentPage = (): PageMessage => ({
      type: 'page',
      shelfmark: readArchiumShelfmark(document, new URL(location.href)),
    })

    let lastSent = ''
    const publish = () => {
      const message = currentPage()
      const serialized = JSON.stringify(message)
      if (serialized === lastSent) return
      lastSent = serialized
      browser.runtime.sendMessage(message).catch(() => undefined)
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!pageRequestSchema.safeParse(message).success) return
      sendResponse(currentPage())
    })

    ctx.addEventListener(window, 'wxt:locationchange', publish)
    const observer = new MutationObserver(publish)
    observer.observe(document.body, { childList: true, subtree: true })
    ctx.onInvalidated(() => observer.disconnect())
    publish()
  },
})

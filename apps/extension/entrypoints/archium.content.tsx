import '@khronist/ui/theme.css'
import { SelectionOverlay, type SelectionRect } from '@khronist/ui'
import { createRoot, type Root } from 'react-dom/client'
import { browser } from 'wxt/browser'
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root'
import { defineContentScript } from 'wxt/utils/define-content-script'
import {
  pageRequestSchema,
  selectionCommandSchema,
  type FragmentFailedMessage,
  type FragmentMessage,
  type PageMessage,
} from '../messages.ts'
import { archiumMatches, findArchiumScan, readArchiumShelfmark } from '../portal/archium.ts'
import { cropFragment, scanRegion } from '../scan/fragment.ts'

export default defineContentScript({
  matches: archiumMatches,
  cssInjectionMode: 'ui',
  async main(ctx) {
    const overlay = await createShadowRootUi<Root>(ctx, {
      name: 'khronist-selection',
      position: 'modal',
      css: ':host { position: relative !important; z-index: 2147483647 !important; }',
      onMount: (container) => {
        const root = createRoot(container)
        root.render(<SelectionOverlay onSelect={select} onCancel={stopSelection} />)
        return root
      },
      onRemove: (root) => root?.unmount(),
    })

    const currentPage = (): PageMessage => ({
      type: 'page',
      shelfmark: readArchiumShelfmark(document, new URL(location.href)),
      scan: findArchiumScan(document) !== null,
      selecting: overlay.mounted !== undefined,
    })

    const send = (message: PageMessage | FragmentMessage | FragmentFailedMessage) => {
      if (ctx.isInvalid) return
      browser.runtime.sendMessage(message).catch(() => undefined)
    }

    let lastSent = ''
    const publish = () => {
      const message = currentPage()
      const serialized = JSON.stringify(message)
      if (serialized === lastSent) return
      lastSent = serialized
      send(message)
    }

    function startSelection() {
      if (overlay.mounted || !findArchiumScan(document)) return
      overlay.mount()
      publish()
    }

    function stopSelection() {
      if (!overlay.mounted) return
      overlay.remove()
      publish()
    }

    const fail = (reason: FragmentFailedMessage['reason']) =>
      send({ type: 'fragment-failed', reason, shelfmark: currentPage().shelfmark })

    function select(selection: SelectionRect) {
      stopSelection()
      const scan = findArchiumScan(document)
      if (!scan?.complete || scan.naturalWidth === 0) {
        fail('not_loaded')
        return
      }
      const region = scanRegion(selection, scan.getBoundingClientRect(), {
        width: scan.naturalWidth,
        height: scan.naturalHeight,
      })
      if (!region) {
        fail('outside')
        return
      }
      const { shelfmark } = currentPage()
      cropFragment(scan, region).then(
        (fragment) => send({ type: 'fragment', fragment, shelfmark }),
        () => fail('crop'),
      )
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (pageRequestSchema.safeParse(message).success) {
        sendResponse(currentPage())
        return
      }
      const command = selectionCommandSchema.safeParse(message)
      if (!command.success) return
      if (command.data.type === 'start-selection') startSelection()
      else stopSelection()
    })

    ctx.addEventListener(window, 'wxt:locationchange', publish)
    const observer = new MutationObserver(publish)
    observer.observe(document.body, { childList: true, subtree: true })
    ctx.onInvalidated(() => observer.disconnect())
    publish()
  },
})

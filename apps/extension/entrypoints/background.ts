import { browser } from 'wxt/browser'
import { defineBackground } from 'wxt/utils/define-background'

export default defineBackground(() => {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })

  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== 'open-panel' || tab?.windowId === undefined) return
    void browser.sidePanel.open({ windowId: tab.windowId })
  })
})

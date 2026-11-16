import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'

const firstRunKey = 'firstRunSeen'

export const useFirstRun = () => {
  const [seen, setSeen] = useState<boolean>()

  useEffect(() => {
    browser.storage.local.get(firstRunKey).then(
      (stored) => setSeen(stored[firstRunKey] === true),
      () => setSeen(true),
    )
  }, [])

  const finish = useCallback(() => {
    setSeen(true)
    void browser.storage.local.set({ [firstRunKey]: true })
  }, [])

  return { seen, finish }
}

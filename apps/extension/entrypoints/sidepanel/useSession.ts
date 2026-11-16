import { useCallback, useEffect, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { loadSession, type SessionUser } from '../../api/auth.ts'
import { sessionTokenKey } from '../../api/token.ts'

type Session =
  { status: 'loading' } | { status: 'signed-out' } | { status: 'signed-in'; user: SessionUser }

export const useSession = () => {
  const [session, setSession] = useState<Session>({ status: 'loading' })
  const latestCheck = useRef(0)

  const refresh = useCallback(async () => {
    const check = (latestCheck.current += 1)
    const user = await loadSession().catch(() => undefined)
    if (check !== latestCheck.current) return
    setSession(user ? { status: 'signed-in', user } : { status: 'signed-out' })
  }, [])

  useEffect(() => {
    void refresh()
    const onChanged = (changes: Record<string, unknown>, areaName: string) => {
      if (areaName === 'session' && sessionTokenKey in changes) void refresh()
    }
    browser.storage.onChanged.addListener(onChanged)
    return () => browser.storage.onChanged.removeListener(onChanged)
  }, [refresh])

  return { session, refresh }
}

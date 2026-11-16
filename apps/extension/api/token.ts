import { browser } from 'wxt/browser'

export const sessionTokenKey = 'sessionToken'

export const readToken = async (): Promise<string | undefined> => {
  const stored = await browser.storage.session.get(sessionTokenKey)
  const token = stored[sessionTokenKey]
  return typeof token === 'string' ? token : undefined
}

export const saveToken = (token: string) =>
  browser.storage.session.set({ [sessionTokenKey]: token })

export const clearToken = () => browser.storage.session.remove(sessionTokenKey)

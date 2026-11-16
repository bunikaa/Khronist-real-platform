import { sessionResponseSchema, type SessionResponse } from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { ApiFailure, send, sendSignedIn } from './client.ts'
import { clearToken, readToken, saveToken } from './token.ts'

export type SessionUser = NonNullable<SessionResponse>['user']

const signOutTimeoutMs = 5000

const postJson = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const requestCode = async (email: string): Promise<void> => {
  await send('/api/auth/email-otp/send-verification-otp', postJson({ email, type: 'sign-in' }))
}

export const signIn = async (email: string, otp: string): Promise<void> => {
  const response = await send('/api/auth/sign-in/email-otp', postJson({ email, otp }))
  const token = response.headers.get('set-auth-token')
  if (!token) throw new ApiFailure('internal_error', strings.read.badResponse)
  await saveToken(token)
}

export const loadSession = async (): Promise<SessionUser | undefined> => {
  const token = await readToken()
  if (!token) return undefined
  const response = await send('/api/auth/get-session', {
    headers: { authorization: `Bearer ${token}` },
  })
  const session = sessionResponseSchema.parse(await response.json())
  if ((await readToken()) !== token) return undefined
  if (!session) await clearToken()
  return session?.user
}

export const signOut = async (): Promise<void> => {
  const token = await readToken()
  await clearToken()
  if (!token) return
  await send('/api/auth/sign-out', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(signOutTimeoutMs),
  }).catch(() => undefined)
}

export const saveName = async (name: string): Promise<void> => {
  await sendSignedIn('/api/auth/update-user', postJson({ name }))
}

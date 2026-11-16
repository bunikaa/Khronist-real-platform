import { strings } from '@khronist/ui'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage, resetFakeStorage } from './fake-storage.ts'

vi.mock('wxt/browser', async () => {
  const { fakeStorage: storage } = await import('./fake-storage.ts')
  return { browser: { storage } }
})

const { loadSession, requestCode, saveName, signIn, signOut } = await import('../api/auth.ts')
const { ApiFailure, getRecognition } = await import('../api/client.ts')
const { apiOrigin } = await import('../api/origin.ts')

const email = 'olena.k@khronist.example'
const token = 'session-token.signature'
const user = { id: 'user-1', email, name: 'Олена К.' }
const recognitionId = '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c'

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const failure = (code: string, message: string, status = 400) =>
  json({ error: { code, message } }, status)

const stubFetch = (...responses: (Response | Error)[]) => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  for (const response of responses) {
    if (response instanceof Error) fetch.mockRejectedValueOnce(response)
    else fetch.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const requestOf = (fetch: ReturnType<typeof stubFetch>, call = 0) => {
  const [url, init] = fetch.mock.calls[call] ?? []
  return {
    url: String(url),
    method: init?.method ?? 'GET',
    authorization: new Headers(init?.headers).get('authorization'),
    body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
  }
}

const signedIn = () => fakeStorage.session.set({ sessionToken: token })

afterEach(() => {
  vi.unstubAllGlobals()
  resetFakeStorage()
})

describe('sign-in by a code from the email', () => {
  it('asks the API to send a sign-in code to the address', async () => {
    const fetch = stubFetch(json({ success: true }))

    await requestCode(email)

    expect(requestOf(fetch)).toEqual({
      url: `${apiOrigin}/api/auth/email-otp/send-verification-otp`,
      method: 'POST',
      authorization: null,
      body: { email, type: 'sign-in' },
    })
  })

  it('keeps the session token from set-auth-token and sends it as a bearer token', async () => {
    const fetch = stubFetch(
      json({ token: 'ignored' }, 200, { 'set-auth-token': token }),
      json({ recognitionId, status: 'queued' }),
    )

    await signIn(email, '123456')
    await getRecognition(recognitionId, new AbortController().signal)

    expect(requestOf(fetch, 0)).toMatchObject({
      url: `${apiOrigin}/api/auth/sign-in/email-otp`,
      method: 'POST',
      body: { email, otp: '123456' },
    })
    expect(fakeStorage.session.items.get('sessionToken')).toBe(token)
    expect(requestOf(fetch, 1).authorization).toBe(`Bearer ${token}`)
  })

  it('fails instead of pretending to be signed in when the token header is missing', async () => {
    stubFetch(json({ token: 'ignored' }))

    await expect(signIn(email, '123456')).rejects.toBeInstanceOf(ApiFailure)
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it.each([
    ['invalid_otp', 'Невірний код', 400],
    ['otp_expired', 'Код прострочено, запросіть новий', 400],
    ['too_many_attempts', 'Забагато спроб, запросіть новий код', 403],
    ['too_many_requests', 'Забагато кодів на цю адресу, спробуйте за 15 хвилин', 429],
    ['invalid_origin', 'Запит із недовіреного джерела', 403],
  ])('passes the %s error of the API through with its message', async (code, message, status) => {
    stubFetch(failure(code, message, status))

    const error = await signIn(email, '123456').catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiFailure)
    expect(error).toMatchObject({ code, message })
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('sends no authorization header without a session', async () => {
    const fetch = stubFetch(json({ recognitionId, status: 'queued' }))

    await getRecognition(recognitionId, new AbortController().signal)

    expect(requestOf(fetch).authorization).toBeNull()
  })
})

describe('the session of the panel', () => {
  it('asks nothing without a token', async () => {
    const fetch = stubFetch()

    expect(await loadSession()).toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('returns the user of a valid session', async () => {
    await signedIn()
    const fetch = stubFetch(json({ session: { id: 's' }, user: { ...user, image: null } }))

    expect(await loadSession()).toEqual(user)
    expect(requestOf(fetch)).toMatchObject({
      url: `${apiOrigin}/api/auth/get-session`,
      authorization: `Bearer ${token}`,
    })
  })

  it('forgets a token the API no longer knows', async () => {
    await signedIn()
    stubFetch(json(null))

    expect(await loadSession()).toBeUndefined()
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('ignores the answer for a token that was replaced while it was on the way', async () => {
    await signedIn()
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      await fakeStorage.session.remove('sessionToken')
      return json({ session: { id: 's' }, user })
    })
    vi.stubGlobal('fetch', fetch)

    expect(await loadSession()).toBeUndefined()
  })

  it('does not delete a token saved while a null answer for the old one was on the way', async () => {
    await signedIn()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => {
        await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
        return json(null)
      }),
    )

    expect(await loadSession()).toBeUndefined()
    expect(fakeStorage.session.items.get('sessionToken')).toBe('newer-token.signature')
  })

  it('keeps the token when the network is down', async () => {
    await signedIn()
    stubFetch(new TypeError('Failed to fetch'))

    await expect(loadSession()).rejects.toBeInstanceOf(TypeError)
    expect(fakeStorage.session.items.get('sessionToken')).toBe(token)
  })

  it('signs out on the API and forgets the token', async () => {
    await signedIn()
    const fetch = stubFetch(json({ success: true }))

    await signOut()

    expect(requestOf(fetch)).toMatchObject({
      url: `${apiOrigin}/api/auth/sign-out`,
      method: 'POST',
      authorization: `Bearer ${token}`,
    })
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('forgets the token before the sign-out request answers', async () => {
    await signedIn()
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise(() => {}))
    vi.stubGlobal('fetch', fetch)

    void signOut()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled())

    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
    expect(requestOf(fetch).authorization).toBe(`Bearer ${token}`)
  })

  it('forgets a token the API rejects while saving the signature', async () => {
    await signedIn()
    stubFetch(failure('unauthorized', 'Потрібен вхід', 401))

    await expect(saveName('Олена К.')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('keeps a token saved while the rejected signature was on the way', async () => {
    await signedIn()
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => {
        await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
        return failure('unauthorized', 'Потрібен вхід', 401)
      }),
    )

    await expect(saveName('Олена К.')).rejects.toMatchObject({ code: 'unauthorized' })
    expect(fakeStorage.session.items.get('sessionToken')).toBe('newer-token.signature')
  })

  it.each([
    ['a server error', failure('internal_error', 'Внутрішня помилка сервера', 500)],
    ['a refused name', failure('bad_request', 'Некоректний запит', 400)],
    ['no network', new TypeError('Failed to fetch')],
  ])('keeps the token when saving the signature fails with %s', async (_case, answer) => {
    await signedIn()
    stubFetch(answer)

    await expect(saveName('Олена К.')).rejects.toBeDefined()
    expect(fakeStorage.session.items.get('sessionToken')).toBe(token)
  })

  it('forgets the token even when the API cannot be reached on sign-out', async () => {
    await signedIn()
    stubFetch(new TypeError('Failed to fetch'))

    await signOut()

    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('saves the signature as the name of the account', async () => {
    await signedIn()
    const fetch = stubFetch(json({ status: true }))

    await saveName('Олена К.')

    expect(requestOf(fetch)).toEqual({
      url: `${apiOrigin}/api/auth/update-user`,
      method: 'POST',
      authorization: `Bearer ${token}`,
      body: { name: 'Олена К.' },
    })
  })
})

describe('the resend countdown', () => {
  it.each([
    [60, 'Надіслати ще раз через 1:00'],
    [58, 'Надіслати ще раз через 0:58'],
    [5, 'Надіслати ще раз через 0:05'],
  ])('shows %i seconds as %s', (seconds, text) => {
    expect(strings.account.signIn.resendIn(seconds)).toBe(text)
  })
})

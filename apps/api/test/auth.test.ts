import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { createTestDatabase, resetDatabase, waitUntil, type TestDatabase } from './helpers.ts'

const baseURL = 'http://localhost:3000'
const email = 'researcher@khronist.example'

let database: TestDatabase
const codes = new Map<string, string>()

const createApp = () =>
  buildApp({
    logLevel: 'silent',
    providers: { llm: 'ok', htr: 'fixture' },
    checkDb: async () => true,
    corsOrigins: ['https://khronist.example'],
    auth: {
      db: database.db,
      secret: 's'.repeat(32),
      baseURL,
      sendCode: async (to, code) => {
        codes.set(to, code)
      },
    },
  })

type App = Awaited<ReturnType<typeof createApp>>

const requestCode = (app: App, headers: Record<string, string> = {}) =>
  app.inject({
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers,
    payload: { email, type: 'sign-in' },
  })

const signIn = async (app: App, headers: Record<string, string> = {}) => {
  const sent = await requestCode(app, headers)
  expect(sent.statusCode).toBe(200)
  await waitUntil(() => codes.has(email))
  return app.inject({
    method: 'POST',
    url: '/api/auth/sign-in/email-otp',
    headers,
    payload: { email, otp: codes.get(email) },
  })
}

const sessionOf = (app: App, token: string) =>
  app.inject({
    method: 'GET',
    url: '/api/auth/get-session',
    headers: { authorization: `Bearer ${token}` },
  })

beforeAll(async () => {
  database = await createTestDatabase()
})

afterAll(async () => {
  await database.client.close()
})

beforeEach(async () => {
  codes.clear()
  await resetDatabase(database)
})

describe('sign-in with a code from the email', () => {
  it('returns a session token in set-auth-token that works as a bearer token', async () => {
    const app = await createApp()
    const signedIn = await signIn(app)
    expect(signedIn.statusCode).toBe(200)
    const token = signedIn.headers['set-auth-token']
    expect(typeof token).toBe('string')

    const session = await sessionOf(app, String(token))
    expect(session.statusCode).toBe(200)
    expect(session.json().user.email).toBe(email)
    await app.close()
  })

  it('accepts a request from any extension, whose id differs on every machine', async () => {
    const app = await createApp()
    const signedIn = await signIn(app, {
      origin: 'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
    })
    expect(signedIn.statusCode).toBe(200)
    await app.close()
  })

  it('refuses a request from a site that is not trusted', async () => {
    const app = await createApp()
    const sent = await requestCode(app, {
      origin: 'https://attacker.example',
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'cors',
    })
    expect(sent.statusCode).toBe(403)
    expect(codes.size).toBe(0)
    await app.close()
  })

  it('refuses a wrong code', async () => {
    const app = await createApp()
    await requestCode(app)
    await waitUntil(() => codes.has(email))
    const wrong = codes.get(email) === '000000' ? '111111' : '000000'
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      payload: { email, otp: wrong },
    })
    expect(signedIn.statusCode).toBe(400)
    expect(signedIn.json().code).toBe('INVALID_OTP')
    expect(signedIn.headers['set-auth-token']).toBeUndefined()
    await app.close()
  })

  it('ends the session on sign-out', async () => {
    const app = await createApp()
    const token = String((await signIn(app)).headers['set-auth-token'])
    const signedOut = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(signedOut.statusCode).toBe(200)
    const session = await sessionOf(app, token)
    expect(session.json()).toBeNull()
    await app.close()
  })

  it('has no sign-in routes without mail settings', async () => {
    const app = await buildApp({
      logLevel: 'silent',
      providers: { llm: 'ok', htr: 'fixture' },
      checkDb: async () => true,
    })
    expect((await requestCode(app)).statusCode).toBe(404)
    await app.close()
  })
})

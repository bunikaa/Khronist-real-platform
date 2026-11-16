import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../src/app.ts'
import { session, verification } from '../src/db/schema.ts'
import { createTestDatabase, resetDatabase, waitUntil, type TestDatabase } from './helpers.ts'

const baseURL = 'http://localhost:3000'
const email = 'researcher@khronist.example'

let database: TestDatabase
const codes = new Map<string, string>()

type AppOptions = { codesPerDay?: number; db?: TestDatabase['db']; logs?: string[] }

const createApp = (options: AppOptions = {}) =>
  buildApp({
    logLevel: options.logs ? 'info' : 'silent',
    ...(options.logs && { logStream: { write: (line: string) => void options.logs?.push(line) } }),
    providers: { llm: 'ok', htr: 'fixture' },
    checkDb: async () => true,
    corsOrigins: ['https://khronist.example'],
    auth: {
      db: options.db ?? database.db,
      secret: 's'.repeat(32),
      baseURL,
      codesPerDay: options.codesPerDay ?? 100,
      verifierEmails: [],
      sendCode: async (to, code) => {
        codes.set(to, code)
      },
    },
  })

type App = Awaited<ReturnType<typeof createApp>>

const requestCode = (
  app: App,
  headers: Record<string, string> = {},
  to = email,
  remoteAddress = '127.0.0.1',
) =>
  app.inject({
    remoteAddress,
    method: 'POST',
    url: '/api/auth/email-otp/send-verification-otp',
    headers,
    payload: { email: to, type: 'sign-in' },
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
    expect(sent.json().error.code).toBe('invalid_origin')
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
    expect(signedIn.json().error).toEqual({ code: 'invalid_otp', message: 'Невірний код' })
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

  it('keeps codes encrypted and refuses an unsigned session token', async () => {
    const app = await createApp()
    await requestCode(app)
    await waitUntil(() => codes.has(email))
    const stored = await database.db.select().from(verification)
    expect(stored).toHaveLength(1)
    expect(stored[0]?.value).not.toContain(String(codes.get(email)))
    codes.clear()
    const signedIn = await signIn(app)
    const [row] = await database.db.select().from(session)
    expect(String(signedIn.headers['set-auth-token'])).toContain('.')
    const unsigned = await sessionOf(app, String(row?.token))
    expect(unsigned.json()).toBeNull()
    await app.close()
  })

  it('exposes only the sign-in routes of the contract', async () => {
    const app = await createApp()
    const token = String((await signIn(app)).headers['set-auth-token'])
    for (const url of ['/api/auth/update-user', '/api/auth/email-otp/reset-password']) {
      const res = await app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${token}` },
        payload: { name: 'x', email, otp: '000000', password: 'password123' },
      })
      expect(res.statusCode).toBe(404)
      expect(res.json().error.code).toBe('not_found')
    }
    const reset = await app.inject({
      method: 'POST',
      url: '/api/auth/email-otp/send-verification-otp',
      payload: { email, type: 'forget-password' },
    })
    expect(reset.statusCode).toBe(400)
    expect(reset.json().error.code).toBe('bad_request')
    await app.close()
  })

  it('sends at most three codes to one address in fifteen minutes', async () => {
    const app = await createApp()
    for (let i = 0; i < 3; i += 1) expect((await requestCode(app)).statusCode).toBe(200)
    const limited = await requestCode(app)
    expect(limited.statusCode).toBe(429)
    expect(limited.json().error.code).toBe('too_many_requests')
    expect(limited.headers['retry-after']).toBeDefined()
    expect((await requestCode(app, {}, 'other@khronist.example')).statusCode).toBe(200)
    await app.close()
  })

  it('stops sending codes once the daily limit is spent', async () => {
    const app = await createApp({ codesPerDay: 1 })
    expect((await requestCode(app)).statusCode).toBe(200)
    await waitUntil(() => codes.has(email))
    const limited = await requestCode(app, {}, 'other@khronist.example')
    expect(limited.statusCode).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect(codes.has('other@khronist.example')).toBe(false)
    await app.close()
  })

  it('keeps the exposed headers of the API next to the session token header', async () => {
    const app = await createApp()
    const signedIn = await signIn(app, { origin: 'https://khronist.example' })
    const exposed = String(signedIn.headers['access-control-expose-headers'])
    expect(exposed).toContain('set-auth-token')
    expect(exposed).toContain('x-request-id')
    await app.close()
  })

  it('answers a database failure in the contract shape and logs no address, code or token', async () => {
    const token = String((await signIn(await createApp())).headers['set-auth-token'])
    const broken = await createTestDatabase()
    await broken.client.close()
    const logs: string[] = []
    const printed = (...args: unknown[]) => void logs.push(args.map(String).join(' '))
    const consoleSpies = (['error', 'warn', 'log', 'info'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(printed),
    )
    const app = await createApp({ db: broken.db, logs })
    const sent = await requestCode(app)
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      payload: { email, otp: '123456' },
    })
    const current = await sessionOf(app, token)
    for (const res of [sent, signedIn, current]) {
      expect(res.statusCode).toBe(500)
      expect(res.json().error.code).toBe('internal_error')
    }
    for (const spy of consoleSpies) spy.mockRestore()
    const written = logs.join('')
    expect(written).toContain('Failed query')
    expect(written).not.toContain('params:')
    expect(written).not.toContain(email)
    expect(written).not.toContain('123456')
    expect(written).not.toContain(token.split('.')[0])
    await app.close()
  })

  it('does not spend the limit of an address on requests that send nothing', async () => {
    const app = await createApp()
    const forged = { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site' }
    for (let i = 0; i < 3; i += 1) expect((await requestCode(app, forged)).statusCode).toBe(403)
    expect((await requestCode(app)).statusCode).toBe(200)
    await app.close()
  })

  it('counts plus addresses as the same address', async () => {
    const app = await createApp()
    for (let i = 0; i < 3; i += 1) {
      const to = `researcher+${i}@khronist.example`
      expect((await requestCode(app, {}, to)).statusCode).toBe(200)
    }
    expect((await requestCode(app)).statusCode).toBe(429)
    await app.close()
  })

  it('answers 429 instead of a silent 200 when parallel requests exceed the daily limit', async () => {
    const app = await createApp({ codesPerDay: 1 })
    const answers = await Promise.all(
      ['a', 'b', 'c'].map((name) => requestCode(app, {}, `${name}@khronist.example`)),
    )
    expect(answers.map((res) => res.statusCode).sort()).toEqual([200, 429, 429])
    await app.close()
  })

  it('answers a sign-in without a code in the contract shape', async () => {
    const app = await createApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      payload: { email },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    await app.close()
  })

  it('lets the owner of an address sign in while someone else spends its codes', async () => {
    const app = await createApp()
    for (let i = 0; i < 3; i += 1) {
      expect((await requestCode(app, {}, email, '203.0.113.9')).statusCode).toBe(200)
    }
    for (let i = 0; i < 3; i += 1) {
      await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email-otp',
        remoteAddress: '203.0.113.9',
        payload: { email, otp: '000000' },
      })
    }
    codes.clear()
    expect((await requestCode(app, {}, email, '198.51.100.4')).statusCode).toBe(200)
    await waitUntil(() => codes.has(email))
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      remoteAddress: '198.51.100.4',
      payload: { email, otp: codes.get(email) },
    })
    expect(signedIn.statusCode).toBe(200)
    await app.close()
  })

  it('caps one address at ten codes in fifteen minutes from all addresses together', async () => {
    const app = await createApp()
    const statuses = []
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await requestCode(app, {}, email, `203.0.113.${i}`)).statusCode)
    }
    expect(statuses).toEqual([...Array(10).fill(200), 429])
    await app.close()
  })

  it('counts dotted Gmail addresses as one address', async () => {
    const app = await createApp()
    for (const to of [
      'r.esearcher@gmail.com',
      're.searcher@googlemail.com',
      'researcher@gmail.com',
    ]) {
      expect((await requestCode(app, {}, to)).statusCode).toBe(200)
    }
    expect((await requestCode(app, {}, 'res.earcher@gmail.com')).statusCode).toBe(429)
    await app.close()
  })

  it('refuses a malformed code without spending an attempt', async () => {
    const app = await createApp()
    await requestCode(app)
    await waitUntil(() => codes.has(email))
    for (const otp of ['abcdef', '12345', '1234567']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email-otp',
        payload: { email, otp },
      })
      expect(res.statusCode).toBe(400)
      expect(res.json().error.code).toBe('bad_request')
    }
    const signedIn = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email-otp',
      payload: { email, otp: codes.get(email) },
    })
    expect(signedIn.statusCode).toBe(200)
    await app.close()
  })
})

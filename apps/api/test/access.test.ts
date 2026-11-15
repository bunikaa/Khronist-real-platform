import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  createRecordingReader,
  createTestApp,
  createTestDatabase,
  makePng,
  parseSse,
  recognitionBody,
  resetDatabase,
  waitUntil,
  type TestAppOptions,
  type TestDatabase,
} from './helpers.ts'

const url = '/v1/recognitions'
const origin = 'chrome-extension://abcdef'

describe('guest access', () => {
  let database: TestDatabase
  let close: () => Promise<void> = async () => {}
  let width = 10
  const freshBody = () => recognitionBody(makePng((width += 1), 10))

  beforeAll(async () => {
    database = await createTestDatabase()
  })

  afterEach(async () => {
    await close()
    await resetDatabase(database)
  })

  afterAll(async () => {
    await database.client.close()
  })

  const start = async (options: TestAppOptions) => {
    const testApp = await createTestApp(database, options)
    close = async () => {
      await testApp.queue.onIdle()
      await testApp.app.close()
    }
    return testApp
  }

  describe('daily limit', () => {
    it('stops the reader after the limit and tells the client when to return', async () => {
      const recording = createRecordingReader()
      const { app, queue } = await start({ guestRecognitionsPerDay: 2, reader: recording.reader })
      const send = () => app.inject({ method: 'POST', url, payload: freshBody() })

      expect((await send()).statusCode).toBe(201)
      expect((await send()).statusCode).toBe(201)
      const blocked = await send()
      await queue.onIdle()

      expect(blocked.statusCode).toBe(429)
      expect(blocked.json()).toEqual({
        error: {
          code: 'too_many_requests',
          message: 'Денний ліміт розпізнавань вичерпано, спробуйте завтра',
        },
      })
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(86_000)
      expect(recording.inputs).toHaveLength(2)
    })

    it('does not spend the limit on answers from the cache', async () => {
      const { app, queue } = await start({ guestRecognitionsPerDay: 1 })
      const payload = freshBody()
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(201)
      await queue.onIdle()
      for (let i = 0; i < 3; i += 1) {
        const again = await app.inject({ method: 'POST', url, payload })
        expect(again.json().status).toBe('cached')
      }
      expect((await app.inject({ method: 'POST', url, payload: freshBody() })).statusCode).toBe(429)
    })

    it('counts each address separately and leaves reading results open', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1 })
      const send = (remoteAddress: string) =>
        app.inject({ method: 'POST', url, payload: freshBody(), remoteAddress })
      const first = await send('203.0.113.1')
      const blocked = await send('203.0.113.1')
      const other = await send('203.0.113.2')
      const state = await app.inject({
        method: 'GET',
        url: `${url}/${first.json().recognitionId}`,
        remoteAddress: '203.0.113.1',
      })

      expect(blocked.statusCode).toBe(429)
      expect(other.statusCode).toBe(201)
      expect(state.statusCode).toBe(200)
    })

    it('ignores a forwarded address the client wrote', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1 })
      const send = (forwarded: string) =>
        app.inject({
          method: 'POST',
          url,
          payload: freshBody(),
          headers: { 'x-forwarded-for': forwarded },
        })

      expect((await send('198.51.100.1')).statusCode).toBe(201)
      expect((await send('198.51.100.2')).statusCode).toBe(429)
    })

    it('takes the address from the header the proxy sets', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1, clientIpHeader: 'x-real-ip' })
      const send = (headers: Record<string, string>) =>
        app.inject({ method: 'POST', url, payload: freshBody(), headers })

      expect((await send({ 'x-real-ip': '203.0.113.9' })).statusCode).toBe(201)
      expect(
        (await send({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' })).statusCode,
      ).toBe(429)
      expect((await send({ 'x-real-ip': '203.0.113.10' })).statusCode).toBe(201)
    })

    it('counts one IPv6 subnet as one guest', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1, clientIpHeader: 'x-real-ip' })
      const send = (address: string) =>
        app.inject({ method: 'POST', url, payload: freshBody(), headers: { 'x-real-ip': address } })

      expect((await send('2001:db8:1:2::1')).statusCode).toBe(201)
      expect((await send('2001:db8:1:2::ffff')).statusCode).toBe(429)
    })

    it('falls back to the socket address when the header is not an address', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1, clientIpHeader: 'x-real-ip' })
      const send = (address: string) =>
        app.inject({ method: 'POST', url, payload: freshBody(), headers: { 'x-real-ip': address } })

      expect((await send('not-an-address')).statusCode).toBe(201)
      expect((await send('also-not-an-address')).statusCode).toBe(429)
    })
  })

  describe('short limits', () => {
    it('refuses a fourth recognition running at once for one guest, not for another', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await start({ reader: recorder.reader, clientIpHeader: 'x-real-ip' })
      const send = (address: string) =>
        app.inject({ method: 'POST', url, payload: freshBody(), headers: { 'x-real-ip': address } })

      const own = [await send('203.0.113.5'), await send('203.0.113.5'), await send('203.0.113.5')]
      const fourth = await send('203.0.113.5')
      const other = await send('203.0.113.6')

      expect(own.map((res) => res.statusCode)).toEqual([201, 201, 201])
      expect(fourth.statusCode).toBe(429)
      expect(fourth.json().error.code).toBe('too_many_requests')
      expect(other.statusCode).toBe(201)
      recorder.release()
      await queue.onIdle()
      expect((await send('203.0.113.5')).statusCode).toBe(201)
      await queue.onIdle()
    })

    it('allows ten recognition requests a minute, cached answers included', async () => {
      const { app, queue } = await start({})
      const payload = freshBody()
      await app.inject({ method: 'POST', url, payload })
      await queue.onIdle()
      for (let i = 1; i < 10; i += 1) await app.inject({ method: 'POST', url, payload })
      const blocked = await app.inject({ method: 'POST', url, payload })
      expect(blocked.statusCode).toBe(429)
      expect(blocked.json().error.message).toBe('Забагато запитів, спробуйте за хвилину')
    })

    it('allows 120 reads of recognitions a minute across state and stream', async () => {
      const { app, queue } = await start({})
      const created = await app.inject({ method: 'POST', url, payload: freshBody() })
      await queue.onIdle()
      const id = created.json().recognitionId
      for (let i = 0; i < 60; i += 1) {
        await app.inject({ method: 'GET', url: `${url}/${id}` })
        await app.inject({ method: 'GET', url: `${url}/${id}/events` })
      }
      const blocked = await app.inject({ method: 'GET', url: `${url}/${id}` })
      expect(blocked.statusCode).toBe(429)
      expect(blocked.json().error.code).toBe('too_many_requests')
    })

    it('refuses a sixth open stream for one guest and tells it when to retry', async () => {
      const recorder = createRecordingReader({ gated: true })
      const { app, queue } = await start({ reader: recorder.reader, maxStreamMs: 2000 })
      const created = await app.inject({ method: 'POST', url, payload: freshBody() })
      const id = created.json().recognitionId
      await waitUntil(() => recorder.inputs.length === 1)
      const address = await app.listen({ port: 0, host: '127.0.0.1' })
      const controller = new AbortController()
      const open = await Promise.all(
        Array.from({ length: 5 }, () =>
          fetch(`${address}${url}/${id}/events`, { signal: controller.signal }),
        ),
      )
      const sixth = await fetch(`${address}${url}/${id}/events`)

      expect(open.map((res) => res.status)).toEqual([200, 200, 200, 200, 200])
      expect(sixth.status).toBe(429)
      expect(sixth.headers.get('retry-after')).toBe('10')
      controller.abort()
      recorder.release()
      await queue.onIdle()
    })
  })

  describe('server state', () => {
    it('answers every request with the contract error while the server shuts down', async () => {
      const { app } = await start({ isShuttingDown: () => true })
      const res = await app.inject({ method: 'POST', url, payload: freshBody() })
      expect(res.statusCode).toBe(503)
      expect(res.headers['retry-after']).toBe('5')
      expect(res.json()).toEqual({
        error: {
          code: 'shutting_down',
          message: 'Сервер перезапускається, спробуйте за кілька секунд',
        },
      })
    })

    it('takes the request id from Railway and returns it', async () => {
      const { app } = await start({})
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { 'x-railway-request-id': 'railway-abc' },
      })
      expect(res.headers['x-request-id']).toBe('railway-abc')
      const own = await app.inject({ method: 'GET', url: '/health' })
      expect(own.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    })
  })

  describe('CORS', () => {
    it('answers a preflight for an allowed origin without spending the limit', async () => {
      const { app } = await start({ corsOrigins: [origin], guestRecognitionsPerDay: 1 })
      const preflight = () =>
        app.inject({
          method: 'OPTIONS',
          url,
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type',
          },
        })

      await preflight()
      const res = await preflight()

      expect(res.statusCode).toBe(204)
      expect(res.headers['access-control-allow-origin']).toBe(origin)
      expect(res.headers['access-control-allow-credentials']).toBe('true')
      expect(res.headers['access-control-allow-headers']).toContain('content-type')
    })

    it('allows the methods that editing and deleting will need', async () => {
      const { app } = await start({ corsOrigins: [origin] })
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/v1/transcriptions/any/lines',
        headers: { origin, 'access-control-request-method': 'PATCH' },
      })
      expect(res.headers['access-control-allow-methods']).toContain('PATCH')
      expect(res.headers['access-control-allow-methods']).toContain('DELETE')
    })

    it('gives an unknown origin no permission', async () => {
      const { app } = await start({ corsOrigins: [origin] })
      const res = await app.inject({
        method: 'GET',
        url: '/health',
        headers: { origin: 'https://attacker.example' },
      })
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('allows nothing when no origins are configured', async () => {
      const { app } = await start({})
      const res = await app.inject({ method: 'GET', url: '/health', headers: { origin } })
      expect(res.headers['access-control-allow-origin']).toBeUndefined()
    })

    it('lets the extension read a limit error and when to retry', async () => {
      const { app } = await start({ corsOrigins: [origin], guestRecognitionsPerDay: 1 })
      const send = () =>
        app.inject({ method: 'POST', url, payload: freshBody(), headers: { origin } })

      await send()
      const blocked = await send()

      expect(blocked.statusCode).toBe(429)
      expect(blocked.headers['access-control-allow-origin']).toBe(origin)
      expect(blocked.headers['access-control-expose-headers']).toContain('retry-after')
    })

    it('carries the permission onto the event stream', async () => {
      const { app, queue } = await start({ corsOrigins: [origin] })
      const created = await app.inject({
        method: 'POST',
        url,
        payload: freshBody(),
        headers: { origin },
      })
      await queue.onIdle()

      const stream = await app.inject({
        method: 'GET',
        url: `${url}/${created.json().recognitionId}/events`,
        headers: { origin },
      })

      expect(stream.headers['content-type']).toContain('text/event-stream')
      expect(stream.headers['access-control-allow-origin']).toBe(origin)
      expect(parseSse(stream.body).at(-1)?.event).toBe('done')
    })
  })
})

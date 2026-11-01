import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createRecordingReader,
  createTestApp,
  createTestDatabase,
  makePng,
  parseSse,
  recognitionBody,
  type TestAppOptions,
  type TestDatabase,
} from './helpers.ts'

const url = '/v1/recognitions'
const origin = 'chrome-extension://abcdef'

describe('guest access', () => {
  let database: TestDatabase
  let close: () => Promise<void>

  beforeEach(async () => {
    database = await createTestDatabase()
  })

  afterEach(async () => {
    await close()
    await database.client.close()
  })

  const start = async (options: TestAppOptions) => {
    const testApp = await createTestApp(database, options)
    close = () => testApp.app.close()
    return testApp
  }

  describe('daily limit', () => {
    it('stops the reader after the limit and tells the client when to return', async () => {
      const recording = createRecordingReader()
      const { app, queue } = await start({ guestRecognitionsPerDay: 2, reader: recording.reader })
      const send = (width: number) =>
        app.inject({ method: 'POST', url, payload: recognitionBody(makePng(width, 10)) })

      expect((await send(10)).statusCode).toBe(201)
      expect((await send(20)).statusCode).toBe(201)
      const blocked = await send(30)
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

    it('counts each address separately and leaves reading results open', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1 })
      const payload = recognitionBody(makePng(10, 10))
      const first = await app.inject({ method: 'POST', url, payload, remoteAddress: '203.0.113.1' })
      const blocked = await app.inject({ method: 'POST', url, payload, remoteAddress: '203.0.113.1' })
      const other = await app.inject({ method: 'POST', url, payload, remoteAddress: '203.0.113.2' })
      const state = await app.inject({
        method: 'GET',
        url: `${url}/${first.json().recognitionId}`,
        remoteAddress: '203.0.113.1',
      })

      expect(blocked.statusCode).toBe(429)
      expect(other.statusCode).toBe(201)
      expect(state.statusCode).toBe(200)
    })

    it('ignores a forged forwarded address without a trusted proxy', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1 })
      const send = (forwarded: string) =>
        app.inject({
          method: 'POST',
          url,
          payload: recognitionBody(makePng(10, 10)),
          headers: { 'x-forwarded-for': forwarded },
        })

      expect((await send('198.51.100.1')).statusCode).toBe(201)
      expect((await send('198.51.100.2')).statusCode).toBe(429)
    })

    it('behind one proxy takes the address the proxy saw, not one the client wrote', async () => {
      const { app } = await start({ guestRecognitionsPerDay: 1, trustProxyHops: 1 })
      const send = (forwarded: string) =>
        app.inject({
          method: 'POST',
          url,
          payload: recognitionBody(makePng(10, 10)),
          headers: { 'x-forwarded-for': forwarded },
        })

      expect((await send('198.51.100.1, 203.0.113.9')).statusCode).toBe(201)
      expect((await send('198.51.100.2, 203.0.113.9')).statusCode).toBe(429)
      expect((await send('198.51.100.1, 203.0.113.10')).statusCode).toBe(201)
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
        app.inject({
          method: 'POST',
          url,
          payload: recognitionBody(makePng(10, 10)),
          headers: { origin },
        })

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
        payload: recognitionBody(makePng(10, 10)),
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

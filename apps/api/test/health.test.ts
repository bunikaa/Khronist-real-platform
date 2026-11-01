import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'

const providers = { llm: 'ok', htr: 'vision' } as const

describe('GET /health', () => {
  it('reports ok when the database answers', async () => {
    const app = await buildApp({ logLevel: 'silent', providers, checkDb: async () => true })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, db: 'ok', llm: 'ok', htr: 'vision' })
    await app.close()
  })

  it('answers 503 when the database check fails', async () => {
    const app = await buildApp({
      logLevel: 'silent',
      providers: { llm: 'degraded', htr: 'down' },
      checkDb: async () => {
        throw new Error('connection refused')
      },
    })
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ ok: false, db: 'down', llm: 'degraded', htr: 'down' })
    await app.close()
  })

  it('does not hang when the database never answers', async () => {
    const app = await buildApp({
      logLevel: 'silent',
      providers,
      dbTimeoutMs: 50,
      checkDb: () => new Promise<boolean>(() => {}),
    })
    const started = Date.now()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json().db).toBe('down')
    expect(Date.now() - started).toBeLessThan(1000)
    await app.close()
  })
})

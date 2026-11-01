import { describe, expect, it } from 'vitest'
import { buildApp } from '../src/app.ts'
import { maxBodyBytes } from '../src/lib/limits.ts'

const providers = { llm: 'ok', htr: 'vision' } as const

const makeApp = async () => {
  const app = await buildApp({ logLevel: 'silent', providers, checkDb: async () => true })
  app.get('/boom', async () => {
    throw new Error('secret database password leaked in a stack trace')
  })
  app.get('/limited', async () => {
    throw Object.assign(new Error('slow down'), { statusCode: 429 })
  })
  app.post('/echo', async (request) => ({ received: request.body }))
  return app
}

describe('error handling', () => {
  it('answers unknown routes with the error contract', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'not_found', message: 'Не знайдено' } })
    await app.close()
  })

  it('hides internal error details', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/boom' })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({
      error: { code: 'internal_error', message: 'Внутрішня помилка сервера' },
    })
    expect(res.body).not.toContain('password')
    await app.close()
  })

  it('labels a rate limit error as such, not as an internal error', async () => {
    const app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/limited' })
    expect(res.statusCode).toBe(429)
    expect(res.json().error.code).toBe('too_many_requests')
    await app.close()
  })

  it('rejects malformed JSON with bad_request', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"broken":',
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error.code).toBe('bad_request')
    await app.close()
  })

  it('rejects an oversized body with the too_large code', async () => {
    const app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ image: 'a'.repeat(maxBodyBytes + 1) }),
    })
    expect(res.statusCode).toBe(413)
    expect(res.json().error.code).toBe('too_large')
    await app.close()
  })
})

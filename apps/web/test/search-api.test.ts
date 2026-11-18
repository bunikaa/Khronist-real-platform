import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRecentPage, loadSearchPage, recentUrl, searchUrl } from '../src/api/search.ts'
import { json, recentPage, searchPage } from './fixtures.ts'

const respond = (response: Response | Error) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response
      return response
    }),
  )

const outcome = () =>
  loadSearchPage(new URLSearchParams('q=x'), undefined, new AbortController().signal)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('searchUrl', () => {
  it('asks the production API and adds the cursor of the next page', () => {
    const params = new URLSearchParams({ q: 'Коваленко', verifiedOnly: 'true' })
    expect(searchUrl(params)).toBe(
      `https://api.khronist.org/v1/search?q=${encodeURIComponent('Коваленко')}&verifiedOnly=true`,
    )
    expect(searchUrl(params, 'eyJyYW5rIjoxfQ')).toBe(
      `https://api.khronist.org/v1/search?q=${encodeURIComponent('Коваленко')}&verifiedOnly=true&cursor=eyJyYW5rIjoxfQ`,
    )
    expect(params.has('cursor')).toBe(false)
  })
})

describe('loadSearchPage', () => {
  it('returns a page that matches the contract', async () => {
    respond(json(200, searchPage))
    expect(await outcome()).toEqual({ ok: true, page: searchPage })
  })

  it.each([
    ['an item without a shelfmark', { items: [{ ...searchPage.items[0], shelfmark: undefined }] }],
    ['an unknown status', { items: [{ ...searchPage.items[0], status: 'approved' }] }],
    ['no items', {}],
  ])('treats %s as a bad response', async (_name, body) => {
    respond(json(200, body))
    expect(await outcome()).toEqual({ ok: false, problem: { kind: 'bad_response' } })
  })

  it('treats a body that is not JSON as a bad response', async () => {
    respond(new Response('<html>', { status: 200 }))
    expect(await outcome()).toEqual({ ok: false, problem: { kind: 'bad_response' } })
  })

  const error = (code: string) => ({ error: { code, message: 'Повідомлення сервера' } })

  it.each([
    [400, {}, { kind: 'rejected' }],
    [429, { 'retry-after': '42' }, { kind: 'rate_limited', retryAfterSeconds: 42 }],
    [429, {}, { kind: 'rate_limited', retryAfterSeconds: undefined }],
    [
      429,
      { 'retry-after': 'Wed, 18 Nov 2026 10:00:00 GMT' },
      { kind: 'rate_limited', retryAfterSeconds: undefined },
    ],
    [500, {}, { kind: 'unavailable' }],
    [503, { 'retry-after': '5' }, { kind: 'unavailable' }],
    [404, {}, { kind: 'bad_response' }],
  ])('maps status %i to a problem', async (status, headers, problem) => {
    respond(json(status, error('any_code'), headers))
    expect(await outcome()).toEqual({ ok: false, problem })
  })

  it('reports a network failure as offline', async () => {
    respond(new TypeError('Failed to fetch'))
    expect(await outcome()).toEqual({ ok: false, problem: { kind: 'offline' } })
  })
})

describe('recentUrl', () => {
  it('asks the production API for the first page and adds the cursor of the next one', () => {
    expect(recentUrl()).toBe('https://api.khronist.org/v1/transcriptions/recent')
    expect(recentUrl('eyJhdCI6MX0')).toBe(
      'https://api.khronist.org/v1/transcriptions/recent?cursor=eyJhdCI6MX0',
    )
  })
})

describe('loadRecentPage', () => {
  const recent = (cursor?: string) =>
    loadRecentPage(new URLSearchParams('q=ignored'), cursor, new AbortController().signal)

  it('asks for the page of the cursor, whatever the search params', async () => {
    respond(json(200, recentPage))
    await recent('abc')
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(recentUrl('abc'))
  })

  it('returns a page that matches the contract', async () => {
    respond(json(200, recentPage))
    expect(await recent()).toEqual({ ok: true, page: recentPage })
  })

  it.each([
    ['a draft', { items: [{ ...recentPage.items[0], status: 'draft' }] }],
    [
      'an item without the time of verification',
      { items: [{ ...recentPage.items[0], verifiedAt: undefined }] },
    ],
  ])('treats %s as a bad response', async (_name, body) => {
    respond(json(200, body))
    expect(await recent()).toEqual({ ok: false, problem: { kind: 'bad_response' } })
  })

  it('maps a rate limit to a problem', async () => {
    respond(
      json(429, { error: { code: 'too_many_requests', message: 'x' } }, { 'retry-after': '7' }),
    )
    expect(await recent()).toEqual({
      ok: false,
      problem: { kind: 'rate_limited', retryAfterSeconds: 7 },
    })
  })
})

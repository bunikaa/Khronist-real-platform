import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchSearchPage, searchUrl } from '../src/api/search.ts'
import { json, searchPage } from './fixtures.ts'

const respond = (response: Response | Error) =>
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response
      return response
    }),
  )

const outcome = () =>
  fetchSearchPage(searchUrl(new URLSearchParams('q=x')), new AbortController().signal)

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

describe('fetchSearchPage', () => {
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

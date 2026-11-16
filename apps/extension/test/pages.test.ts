import type { Transcription } from '@khronist/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('wxt/browser', async () => {
  const { fakeStorage: storage } = await import('./fake-storage.ts')
  return { browser: { storage } }
})

const { resetFakeStorage } = await import('./fake-storage.ts')
const { apiOrigin } = await import('../api/origin.ts')
const { lookupPage } = await import('../api/pages.ts')
const { loadTranscription } = await import('../api/transcriptions.ts')

const shelfmark = {
  archive: 'ЦДІАК України',
  fond: '127',
  opys: '1078',
  sprava: '177',
  image: 4,
  portal: 'archium' as const,
}

const transcription: Transcription = {
  id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 1,
  status: 'draft',
  lines: [],
  normalizedText: '',
  entities: [],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-14T12:00:00.000Z',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stubFetch = (response: Response) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const signal = new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
  resetFakeStorage()
})

describe('looking up a page', () => {
  it('asks by the shelfmark parts and the image number, without the portal', async () => {
    const fetch = stubFetch(json({}))

    expect(await lookupPage(shelfmark, signal)).toEqual({})

    const url = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(`${url.origin}${url.pathname}`).toBe(`${apiOrigin}/v1/pages/lookup`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      archive: 'ЦДІАК України',
      fond: '127',
      opys: '1078',
      sprava: '177',
      image: '4',
    })
  })

  it('asks by the folio when the page has no image number', async () => {
    const fetch = stubFetch(json({}))

    await lookupPage({ ...shelfmark, image: undefined, folio: '14 зв.' }, signal)

    const url = new URL(String(fetch.mock.calls[0]?.[0]))
    expect(url.searchParams.get('folio')).toBe('14 зв.')
    expect(url.searchParams.has('image')).toBe(false)
  })

  it('returns the page with the latest version of each region', async () => {
    const page = {
      id: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
      shelfmark,
      transcriptions: [
        {
          id: transcription.id,
          regionId: transcription.regionId,
          box: transcription.box,
          version: 1,
          status: 'verified',
          createdAt: transcription.createdAt,
        },
      ],
    }
    stubFetch(json({ page }))

    expect(await lookupPage(shelfmark, signal)).toEqual({ page })
  })

  it('rejects an answer outside the contract', async () => {
    stubFetch(json({ page: { id: 'x' } }))

    await expect(lookupPage(shelfmark, signal)).rejects.toMatchObject({ name: 'ZodError' })
  })

  it('passes a rate limit through with the server message', async () => {
    stubFetch(json({ error: { code: 'too_many_requests', message: 'Забагато запитів' } }, 429))

    await expect(lookupPage(shelfmark, signal)).rejects.toMatchObject({
      code: 'too_many_requests',
    })
  })
})

describe('loading a transcription', () => {
  it('reads one version by its id', async () => {
    const fetch = stubFetch(json(transcription))

    expect(await loadTranscription(transcription.id, signal)).toEqual(transcription)
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      `${apiOrigin}/v1/transcriptions/${transcription.id}`,
    )
  })

  it('passes not found through', async () => {
    stubFetch(json({ error: { code: 'not_found', message: 'Не знайдено' } }, 404))

    await expect(loadTranscription(transcription.id, signal)).rejects.toMatchObject({
      code: 'not_found',
    })
  })
})

import type { Citation, Entity, ExplainRequest } from '@khronist/contracts'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('wxt/browser', async () => {
  const { fakeStorage } = await import('./fake-storage.ts')
  return { browser: { storage: fakeStorage } }
})

const { ApiFailure } = await import('../api/client.ts')
const { explain } = await import('../api/explain.ts')
const { canExplain, explainProblemOf, explainRequestFor, useExplain } =
  await import('../entrypoints/sidepanel/useExplain.ts')
const { distinctSources } = await import('../entrypoints/sidepanel/explain.tsx')

const transcriptionId = '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11'
const offline = 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз'
const badResponse = 'Сервер відповів неочікувано. Спробуйте ще раз'
const timedOut = 'Сервер не відповів вчасно. Спробуйте ще раз'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status)

describe('explainRequestFor', () => {
  it.each<[Entity['type'], ExplainRequest['kind']]>([
    ['person', 'entity'],
    ['place', 'place'],
    ['date', 'date'],
    ['term', 'term'],
  ])('asks about a %s chip as %s, with the record for context', (type, kind) => {
    expect(explainRequestFor({ type, text: 'крестьянинъ' }, transcriptionId)).toEqual({
      kind,
      text: 'крестьянинъ',
      context: { transcriptionId },
    })
  })

  it.each([
    [
      'a date by the base form the server reads, as B5 does',
      { type: 'date', text: 'генваря 12 1884', normalized: '12 генваря 1884' },
      '12 генваря 1884',
    ],
    [
      'a date without a base form by its text',
      { type: 'date', text: '12 генваря 1884' },
      '12 генваря 1884',
    ],
    [
      'a date with an empty base form by its text',
      { type: 'date', text: '12 генваря 1884', normalized: '' },
      '12 генваря 1884',
    ],
    [
      'a date with a base form of spaces by its text',
      { type: 'date', text: '12 генваря 1884', normalized: '  ' },
      '12 генваря 1884',
    ],
    [
      'a term by its text, not by its base form',
      { type: 'term', text: 'крестьянинъ', normalized: 'крестьянин' },
      'крестьянинъ',
    ],
    [
      'a person by its text, not by its base form',
      { type: 'person', text: 'Іоанна', normalized: 'Іоанн' },
      'Іоанна',
    ],
  ] as const)('asks about %s', (_case, entity, text) => {
    expect(explainRequestFor(entity, transcriptionId).text).toBe(text)
  })
})

describe('canExplain', () => {
  it.each([
    ['an empty text', { type: 'term', text: '' }, false],
    ['a text of spaces', { type: 'term', text: '   ' }, false],
    ['one letter', { type: 'term', text: 'ъ' }, true],
    ['200 letters', { type: 'term', text: 'а'.repeat(200) }, true],
    ['200 letters with spaces around', { type: 'term', text: ` ${'а'.repeat(200)} ` }, true],
    ['201 letters', { type: 'term', text: 'а'.repeat(201) }, false],
    [
      'a long date text with a short base form',
      { type: 'date', text: 'а'.repeat(201), normalized: '12 генваря 1884' },
      true,
    ],
    [
      'a short date text with an empty base form',
      { type: 'date', text: '12 генваря 1884', normalized: '' },
      true,
    ],
    [
      'a short date text with a base form of spaces',
      { type: 'date', text: '12 генваря 1884', normalized: '   ' },
      true,
    ],
  ] as const)('%s → %s', (_case, entity, explainable) => {
    expect(canExplain(entity)).toBe(explainable)
  })
})

describe('explain', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts the request and returns the answer checked by the contract', async () => {
    const answer = { answer: 'Селянин.', confidence: 'high', citations: [] }
    const fetch = vi.fn(async () => json(answer))
    vi.stubGlobal('fetch', fetch)
    const body = explainRequestFor({ type: 'term', text: 'крестьянинъ' }, transcriptionId)

    await expect(explain(body, AbortSignal.timeout(1000))).resolves.toEqual(answer)

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
    expect(new URL(url).pathname).toBe('/v1/explain')
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual(body)
  })

  it('refuses an answer outside the contract', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ answer: 'Селянин.' })),
    )
    const body = explainRequestFor({ type: 'term', text: 'крестьянинъ' }, transcriptionId)

    await expect(explain(body, AbortSignal.timeout(1000))).rejects.toBeInstanceOf(ZodError)
  })

  it.each([
    [400, 'bad_request', 'Некоректний запит'],
    [413, 'too_large', 'Запит завеликий'],
    [429, 'too_many_requests', 'Денний ліміт пояснень вичерпано, спробуйте завтра'],
    [503, 'reader_unavailable', 'Пояснення тимчасово недоступне'],
    [500, 'internal_error', 'Внутрішня помилка'],
  ])(
    'turns %i into an API failure with the code and text of the server',
    async (status, code, message) => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => failure(status, code, message)),
      )
      const body = explainRequestFor({ type: 'term', text: 'крестьянинъ' }, transcriptionId)

      await expect(explain(body, AbortSignal.timeout(1000))).rejects.toMatchObject({
        code,
        message,
      })
    },
  )
})

describe('explainProblemOf', () => {
  it.each<[string, unknown, { message: string; offline: boolean; retryable: boolean }]>([
    [
      '400: nothing to retry',
      new ApiFailure('bad_request', 'Некоректний запит'),
      { message: 'Некоректний запит', offline: false, retryable: false },
    ],
    [
      '413: nothing to retry',
      new ApiFailure('too_large', 'Запит завеликий'),
      { message: 'Запит завеликий', offline: false, retryable: false },
    ],
    [
      '429 per minute: nothing to retry in the sheet, the chip can be clicked again',
      new ApiFailure('too_many_requests', 'Забагато запитів, спробуйте за хвилину'),
      { message: 'Забагато запитів, спробуйте за хвилину', offline: false, retryable: false },
    ],
    [
      '429 per day: nothing to retry',
      new ApiFailure('too_many_requests', 'Денний ліміт пояснень вичерпано, спробуйте завтра'),
      {
        message: 'Денний ліміт пояснень вичерпано, спробуйте завтра',
        offline: false,
        retryable: false,
      },
    ],
    [
      '503 while the server restarts: retry',
      new ApiFailure('shutting_down', 'Сервер перезапускається'),
      { message: 'Сервер перезапускається', offline: false, retryable: true },
    ],
    [
      '503: the model may answer next time',
      new ApiFailure('reader_unavailable', 'Пояснення тимчасово недоступне'),
      { message: 'Пояснення тимчасово недоступне', offline: false, retryable: true },
    ],
    [
      '500: retry',
      new ApiFailure('internal_error', 'Внутрішня помилка'),
      { message: 'Внутрішня помилка', offline: false, retryable: true },
    ],
    [
      'no network',
      new TypeError('Failed to fetch'),
      { message: offline, offline: true, retryable: true },
    ],
    [
      'no answer in time',
      new DOMException('timed out', 'TimeoutError'),
      { message: timedOut, offline: false, retryable: true },
    ],
    [
      'an answer outside the contract',
      new ZodError([]),
      { message: badResponse, offline: false, retryable: true },
    ],
  ])('%s', (_case, error, problem) => {
    expect(explainProblemOf(error)).toEqual(problem)
  })
})

describe('distinctSources', () => {
  const citation = (sourceId: string, chunk: number): Citation => ({
    kind: 'chunk',
    chunkId: `0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4${chunk}`,
    sourceId,
    title: `Стаття ${sourceId.slice(0, 1)}`,
    licence: 'суспільне надбання',
    retelling: true,
    quote: 'особи, зазвичай чоловік і жінка',
  })
  const a = '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d'
  const b = '2a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d'

  it.each<[string, Citation[], Citation[]]>([
    ['nothing for no citations', [], []],
    ['one source cited once', [citation(a, 1)], [citation(a, 1)]],
    ['one source for two quotes from it', [citation(a, 1), citation(a, 2)], [citation(a, 1)]],
    [
      'the order of the first quote of each source',
      [citation(b, 1), citation(a, 2), citation(b, 3)],
      [citation(b, 1), citation(a, 2)],
    ],
  ])('keeps %s', (_case, citations, expected) => {
    expect(distinctSources(citations)).toEqual(expected)
  })
})

describe('useExplain', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('closes the sheet when the panel shows another version', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ answer: null, reason: 'no_sources', citations: [] })),
    )
    let explaining: ReturnType<typeof useExplain> | undefined
    const Probe = ({ id }: { id: string }) => {
      explaining = useExplain(id)
      return null
    }
    const root = createRoot(document.createElement('div'))
    const newer = '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22'

    await act(async () => root.render(<Probe id={transcriptionId} />))
    await act(async () => explaining?.open({ type: 'term', text: 'крестьянинъ' }))
    expect(explaining?.opened?.entity.text).toBe('крестьянинъ')

    await act(async () => root.render(<Probe id={newer} />))
    expect(explaining?.opened).toBeUndefined()
    act(() => root.unmount())
  })
})

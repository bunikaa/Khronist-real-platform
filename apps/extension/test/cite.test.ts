import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('wxt/browser', async () => {
  const { fakeStorage: storage } = await import('./fake-storage.ts')
  return { browser: { storage } }
})

const { resetFakeStorage } = await import('./fake-storage.ts')
const { apiOrigin } = await import('../api/origin.ts')
const { ApiFailure } = await import('../api/client.ts')
const { citeTranscription } = await import('../api/cite.ts')
const { failureAlertOf, requestFailureOf } = await import('../entrypoints/sidepanel/failures.ts')

const transcriptionId = '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11'
const signal = new AbortController().signal

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const stubFetch = (response: Response) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetFakeStorage()
})

describe('citing a transcription', () => {
  it('posts the transcription, the format and the toggle and returns the text as is', async () => {
    const text = 'ЦДІАК України, ф. 127, оп. 1078, спр. 177, арк. 14зв\nhttps://archium.example/4'
    const fetch = stubFetch(json({ text }))

    const request = { transcriptionId, format: 'text' as const, withTranscription: false }
    expect(await citeTranscription(request, signal)).toBe(text)

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe(`${apiOrigin}/v1/cite`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual(request)
  })

  it.each([
    ['bad_request', 'Некоректний запит', 400],
    ['not_found', 'У фрагмента немає шифру, тож цитату скласти не можна', 404],
    ['too_large', 'Запит завеликий', 413],
    ['too_many_requests', 'Забагато запитів, спробуйте пізніше', 429],
    ['internal_error', 'Внутрішня помилка сервера', 500],
  ])('passes %s through with the server message', async (code, message, status) => {
    stubFetch(json({ error: { code, message } }, status))

    await expect(
      citeTranscription({ transcriptionId, format: 'dstu', withTranscription: true }, signal),
    ).rejects.toMatchObject({ code, message })
  })

  it('rejects an answer outside the contract', async () => {
    stubFetch(json({ citation: 'ЦДІАК України' }))

    await expect(
      citeTranscription({ transcriptionId, format: 'dstu', withTranscription: true }, signal),
    ).rejects.toMatchObject({ name: 'ZodError' })
  })
})

describe('what a failed request offers', () => {
  it.each([
    ['bad_request', false],
    ['not_found', false],
    ['too_large', false],
    ['unauthorized', false],
    ['too_many_requests', true],
    ['internal_error', true],
    ['shutting_down', true],
  ])('offers a retry after %s only when a retry can help', (code, retryable) => {
    expect(requestFailureOf(new ApiFailure(code, 'Повідомлення'))).toEqual({
      message: 'Повідомлення',
      offline: false,
      retryable,
    })
  })

  it.each([
    ['no network', new TypeError('Failed to fetch'), 'Немає зв’язку із сервером', true],
    [
      'a timeout',
      new DOMException('timed out', 'TimeoutError'),
      'Сервер не відповів вчасно',
      false,
    ],
    ['an answer outside the contract', new Error('ZodError'), 'Сервер відповів неочікувано', false],
  ])('names %s and offers a retry', (_name, error, message, offline) => {
    expect(requestFailureOf(error)).toMatchObject({ offline, retryable: true })
    expect(requestFailureOf(error).message).toContain(message)
  })
})

describe('the status bar of a failed request', () => {
  const onRetry = () => undefined
  const onDismiss = () => undefined

  it.each([
    [
      { message: 'Немає звʼязку', offline: true, retryable: true },
      'error',
      'Спробувати ще раз',
      onRetry,
    ],
    [
      { message: 'Забагато запитів', offline: false, retryable: true },
      'warning',
      'Спробувати ще раз',
      onRetry,
    ],
    [
      { message: 'Не знайдено', offline: false, retryable: false },
      'warning',
      'Зрозуміло',
      onDismiss,
    ],
  ])('shows %j as %s with «%s»', (failure, type, action, onAction) => {
    expect(failureAlertOf(failure, { onRetry, onDismiss })).toEqual({
      type,
      message: failure.message,
      action,
      onAction,
    })
  })

  it('names the dismissal the way the screen asks', () => {
    const failure = { message: 'Некоректний запит', offline: false, retryable: false }

    expect(
      failureAlertOf(failure, { onRetry, onDismiss, dismissLabel: 'Скасувати правки' }).action,
    ).toBe('Скасувати правки')
  })
})

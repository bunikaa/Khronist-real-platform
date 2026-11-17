import type { Transcription } from '@khronist/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fakeStorage, resetFakeStorage } from './fake-storage.ts'

vi.mock('wxt/browser', async () => {
  const { fakeStorage: storage } = await import('./fake-storage.ts')
  return { browser: { storage } }
})

const { ApiFailure, VersionConflictFailure } = await import('../api/client.ts')
const { apiOrigin } = await import('../api/origin.ts')
const { saveLines, verifyTranscription } = await import('../api/transcriptions.ts')
const { problemOf } = await import('../entrypoints/sidepanel/failures.ts')
const { answerOf } = await import('../entrypoints/sidepanel/useLineEditing.ts')

const token = 'session-token.signature'

const transcription: Transcription = {
  id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 3,
  status: 'draft',
  lines: [
    {
      idx: 0,
      text: 'Села Борщаговки',
      box: { x: 0, y: 0, w: 1, h: 1 },
      boxSource: 'estimated',
      uncertain: false,
      words: [],
    },
  ],
  normalizedText: 'Села Борщаговки',
  entities: [],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-14T12:00:00.000Z',
}

const edited: Transcription = {
  ...transcription,
  id: '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
  version: 4,
  lines: [{ ...transcription.lines[0]!, text: 'Села Борщаговки крестьянинъ' }],
  normalizedText: 'Села Борщаговки крестьянинъ',
  author: { name: 'Олена К.' },
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const failure = (code: string, message: string, status: number) =>
  json({ error: { code, message } }, status)

const stubFetch = (response: Response | Error) => {
  const fetch = vi.fn<typeof globalThis.fetch>()
  if (response instanceof Error) fetch.mockRejectedValueOnce(response)
  else fetch.mockResolvedValueOnce(response)
  vi.stubGlobal('fetch', fetch)
  return fetch
}

const changes = [{ idx: 0, text: 'Села Борщаговки крестьянинъ' }]
const signal = new AbortController().signal

afterEach(() => {
  vi.unstubAllGlobals()
  resetFakeStorage()
})

describe('saving edited lines', () => {
  it('sends the changed lines on top of the version they were edited in', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    const fetch = stubFetch(json(edited))

    expect(await saveLines(transcription, changes, signal)).toEqual(edited)

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe(`${apiOrigin}/v1/transcriptions/${transcription.id}/lines`)
    expect(init?.method).toBe('PATCH')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ baseVersion: 3, lines: changes })
  })

  it('returns the newer version when the API reports a conflict', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    stubFetch(
      json(
        {
          error: {
            code: 'version_conflict',
            message: 'Транскрипцію вже змінили, ось поточна версія',
          },
          current: edited,
        },
        409,
      ),
    )

    const error = await saveLines(transcription, changes, signal).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(VersionConflictFailure)
    expect(error).toMatchObject({ code: 'version_conflict', current: edited })
  })

  it('forgets a token the API rejects', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    stubFetch(failure('unauthorized', 'Потрібен вхід', 401))

    await expect(saveLines(transcription, changes, signal)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it('keeps a token saved while the rejected request was on the way', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof globalThis.fetch>(async () => {
        await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
        return failure('unauthorized', 'Потрібен вхід', 401)
      }),
    )

    await expect(saveLines(transcription, changes, signal)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fakeStorage.session.items.get('sessionToken')).toBe('newer-token.signature')
  })

  it.each([
    ['bad_request', 'У цій версії немає рядка з таким номером', 400],
    ['not_found', 'Не знайдено', 404],
    ['too_large', 'Запит завеликий', 413],
    ['too_many_requests', 'Забагато запитів, спробуйте пізніше', 429],
  ])(
    'passes %s through with the server message and keeps the token',
    async (code, message, status) => {
      await fakeStorage.session.set({ sessionToken: token })
      stubFetch(failure(code, message, status))

      const error = await saveLines(transcription, changes, signal).catch(
        (caught: unknown) => caught,
      )

      expect(error).toBeInstanceOf(ApiFailure)
      expect(error).not.toBeInstanceOf(VersionConflictFailure)
      expect(error).toMatchObject({ code, message })
      expect(fakeStorage.session.items.get('sessionToken')).toBe(token)
    },
  )

  it('does not take a conflict without the current version for one', async () => {
    stubFetch(failure('version_conflict', 'Конфлікт версій', 409))

    const error = await saveLines(transcription, changes, signal).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ApiFailure)
    expect(error).not.toBeInstanceOf(VersionConflictFailure)
  })

  it('rejects an answer outside the contract', async () => {
    stubFetch(json({ id: edited.id }))

    await expect(saveLines(transcription, changes, signal)).rejects.toMatchObject({
      name: 'ZodError',
    })
  })
})

describe('what the panel makes of a failed save', () => {
  const regionId = transcription.regionId
  const offline = 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз'
  const badResponse = 'Сервер відповів неочікувано. Спробуйте ще раз'
  const timedOut = 'Сервер не відповів вчасно. Спробуйте ще раз'

  it.each([
    ['a lost network', new TypeError('Failed to fetch'), offline, true, true],
    ['a timeout', new DOMException('signal timed out', 'TimeoutError'), timedOut, false, true],
    [
      'an answer outside the contract',
      new SyntaxError('Unexpected token'),
      badResponse,
      false,
      true,
    ],
    ['too many requests', new ApiFailure('too_many_requests', 'Забагато'), 'Забагато', false, true],
    ['a server error', new ApiFailure('internal_error', 'Помилка'), 'Помилка', false, true],
    ['a restart', new ApiFailure('shutting_down', 'Перезапуск'), 'Перезапуск', false, true],
    [
      'a refused request',
      new ApiFailure('bad_request', 'Некоректний'),
      'Некоректний',
      false,
      false,
    ],
    ['a missing version', new ApiFailure('not_found', 'Не знайдено'), 'Не знайдено', false, false],
    ['a too large request', new ApiFailure('too_large', 'Завеликий'), 'Завеликий', false, false],
  ])('treats %s as a failure', async (_case, error, message, isOffline, retryable) => {
    expect(await answerOf(error, regionId)).toEqual({
      type: 'failed',
      regionId,
      message,
      offline: isOffline,
      retryable,
    })
  })

  it('waits for the sign-in when the API rejected the only token', async () => {
    expect(await answerOf(new ApiFailure('unauthorized', 'Потрібен вхід'), regionId)).toEqual({
      type: 'unauthorized',
      regionId,
    })
  })

  it('offers a retry when a newer token is already stored', async () => {
    await fakeStorage.session.set({ sessionToken: token })

    expect(await answerOf(new ApiFailure('unauthorized', 'Потрібен вхід'), regionId)).toMatchObject(
      { type: 'failed', retryable: true },
    )
  })

  it('hands the newer version of a conflict over', async () => {
    expect(await answerOf(new VersionConflictFailure('Змінили', edited), regionId)).toEqual({
      type: 'conflict',
      regionId,
      current: edited,
    })
  })
})

describe('confirming a transcription', () => {
  const verifyPath = `/v1/transcriptions/${transcription.id}/verify`
  const verified: Transcription = {
    ...transcription,
    status: 'verified',
    verifiedBy: { name: 'Олена К.' },
    verifiedSignature: 'Олена К.',
    verifiedAt: '2026-11-16T10:00:00.000Z',
  }

  it('confirms the version the panel shows with the signature of the account', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    const fetch = stubFetch(json(verified))

    expect(await verifyTranscription(transcription, 'Олена К.', signal)).toEqual(verified)

    const [url, init] = fetch.mock.calls[0] ?? []
    expect(String(url)).toBe(`${apiOrigin}${verifyPath}`)
    expect(init?.method).toBe('POST')
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${token}`)
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init?.body))).toEqual({ signature: 'Олена К.' })
  })

  it('sends no signature when the account has no name', async () => {
    const fetch = stubFetch(json(verified))

    await verifyTranscription(transcription, '', signal)

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toEqual({})
  })

  it('returns the newer version when the API reports a conflict', async () => {
    stubFetch(
      json({ error: { code: 'version_conflict', message: 'Конфлікт' }, current: edited }, 409),
    )

    const error = await verifyTranscription(transcription, '', signal).catch(
      (caught: unknown) => caught,
    )

    expect(error).toBeInstanceOf(VersionConflictFailure)
    expect(error).toMatchObject({ current: edited })
  })

  it('forgets a token the API rejects', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    stubFetch(failure('unauthorized', 'Потрібен вхід', 401))

    await expect(verifyTranscription(transcription, '', signal)).rejects.toMatchObject({
      code: 'unauthorized',
    })
    expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
  })

  it.each([
    ['bad_request', 'Некоректний підпис', 400],
    ['forbidden', 'Підтверджувати можуть лише історики проєкту', 403],
    ['not_found', 'Не знайдено', 404],
    ['too_many_requests', 'Забагато запитів, спробуйте пізніше', 429],
  ])('passes %s through with the server message', async (code, message, status) => {
    await fakeStorage.session.set({ sessionToken: token })
    stubFetch(failure(code, message, status))

    await expect(verifyTranscription(transcription, '', signal)).rejects.toMatchObject({
      code,
      message,
    })
    expect(fakeStorage.session.items.get('sessionToken')).toBe(token)
  })

  it('rejects an answer outside the contract', async () => {
    stubFetch(json({ id: transcription.id }))

    await expect(verifyTranscription(transcription, '', signal)).rejects.toMatchObject({
      name: 'ZodError',
    })
  })

  it.each([
    ['forbidden', false],
    ['too_many_requests', true],
    ['internal_error', true],
    ['not_found', false],
  ])('offers a retry after %s only when a retry can help', async (code, retryable) => {
    expect(await problemOf(new ApiFailure(code, 'Повідомлення'))).toEqual({
      kind: 'failed',
      message: 'Повідомлення',
      offline: false,
      retryable,
    })
  })
})

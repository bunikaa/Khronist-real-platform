import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'

vi.mock('wxt/browser', async () => {
  const { fakeStorage } = await import('./fake-storage.ts')
  return { browser: { storage: fakeStorage } }
})

const { transportProblemOf } = await import('../entrypoints/sidepanel/failures.ts')

describe('transportProblemOf', () => {
  it.each([
    [
      'a lost network as offline',
      new TypeError('Failed to fetch'),
      { message: 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз', offline: true },
    ],
    [
      'a timeout as a late server, not as a lost network',
      new DOMException('signal timed out', 'TimeoutError'),
      { message: 'Сервер не відповів вчасно. Спробуйте ще раз', offline: false },
    ],
    [
      'an answer outside the contract as a bad response',
      new ZodError([]),
      { message: 'Сервер відповів неочікувано. Спробуйте ще раз', offline: false },
    ],
    [
      'an aborted request as a bad response',
      new DOMException('aborted', 'AbortError'),
      { message: 'Сервер відповів неочікувано. Спробуйте ще раз', offline: false },
    ],
  ])('reads %s', (_case, error, problem) => {
    expect(transportProblemOf(error)).toEqual(problem)
  })
})

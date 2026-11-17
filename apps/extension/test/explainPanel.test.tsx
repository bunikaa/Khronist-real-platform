import type { ExplainResponse, Shelfmark, Transcription } from '@khronist/contracts'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fragment, PageMessage } from '../messages.ts'

type Listener = (message: unknown, sender: { tab?: { id?: number } }) => void

const listeners = new Set<Listener>()
let currentPage: PageMessage | undefined

vi.mock('wxt/browser', async () => {
  const { fakeStorage } = await import('./fake-storage.ts')
  return {
    browser: {
      storage: fakeStorage,
      tabs: {
        query: async () => [{ id: 1 }],
        sendMessage: async (_tabId: number, message: { type: string }) =>
          message.type === 'get-page' ? currentPage : undefined,
        onActivated: { addListener: () => {}, removeListener: () => {} },
        onUpdated: { addListener: () => {}, removeListener: () => {} },
      },
      runtime: {
        onMessage: {
          addListener: (listener: Listener) => listeners.add(listener),
          removeListener: (listener: Listener) => listeners.delete(listener),
        },
      },
      commands: {
        getAll: async () => [],
        onCommand: { addListener: () => {}, removeListener: () => {} },
      },
    },
  }
})

const { fakeStorage, resetFakeStorage } = await import('./fake-storage.ts')
const { App } = await import('../entrypoints/sidepanel/App.tsx')

const shelfmark: Shelfmark = {
  archive: 'ЦДІАК України',
  fond: '127',
  opys: '1078',
  sprava: '177',
  image: 4,
  portal: 'archium',
}

const fragment: Fragment = {
  base64Png: 'iVBORw0KGgo=',
  imageHash: 'a'.repeat(64),
  box: { x: 0, y: 0, w: 1, h: 1 },
  width: 10,
  height: 10,
}

const lineText = 'Села Борщаговки крестьянинъ 12 генваря 1884 Іоаннъ Петровъ'
let transcriptions = 0

const nextTranscription = (): Transcription => {
  transcriptions += 1
  return {
    id: `5f1d7c1e-4a0b-4d3c-9a43-${String(transcriptions).padStart(12, '0')}`,
    regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
    shelfmark,
    box: { x: 0, y: 0, w: 1, h: 1 },
    version: 1,
    status: 'draft',
    lines: [
      {
        idx: 0,
        text: lineText,
        box: { x: 0, y: 0, w: 1, h: 1 },
        boxSource: 'estimated',
        uncertain: false,
        words: [],
      },
    ],
    normalizedText: lineText,
    entities: [
      { type: 'place', text: 'Борщаговки', start: 5, end: 15 },
      { type: 'term', text: 'крестьянинъ', start: 16, end: 27 },
      { type: 'date', text: '12 генваря 1884', start: 28, end: 43 },
      { type: 'person', text: 'Іоаннъ Петровъ', start: 44, end: 58 },
    ],
    reader: 'claude-sonnet-5-5',
    createdAt: '2026-11-14T12:00:00.000Z',
  }
}

const recognitionId = '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c'
const token = 'session-token.signature'
const verifier = { id: 'u', email: 'olena.k@khronist.example', name: 'Олена К.' }

const citation = (sourceId: string, title: string, url?: string) => ({
  kind: 'chunk' as const,
  chunkId: '9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f',
  sourceId,
  title,
  ...(url && { url }),
  licence: 'суспільне надбання',
  retelling: true,
  quote: 'особи, що належали до сільського стану',
})

const peasants: ExplainResponse = {
  answer: 'Селянин, особа сільського стану.',
  confidence: 'high',
  citations: [
    citation(
      '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
      'Энциклопедический словарь Брокгауза и Ефрона, статья «Крестьяне»',
      'https://ru.wikisource.org/wiki/ЭСБЕ/Крестьяне',
    ),
    citation(
      '1a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
      'Энциклопедический словарь Брокгауза и Ефрона, статья «Крестьяне»',
    ),
    citation('2a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d', 'Словник української мови'),
  ],
}

const date = { julian: '12 січня 1884', gregorian: '24 січня 1884', weekday: 'четвер' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const failure = (status: number, code: string, message: string) =>
  json({ error: { code, message } }, status)

type Route = (init?: RequestInit) => Response | Promise<Response>

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')

describe('explaining a chip (C1)', () => {
  let root: Root
  let container: HTMLElement
  let explains: unknown[]
  let shown: Transcription
  let session: { canVerify: boolean } | null

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await fakeStorage.local.set({ firstRunSeen: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    explains = []
    shown = nextTranscription()
    session = null
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    currentPage = undefined
    resetFakeStorage()
    vi.unstubAllGlobals()
    showModal.mockClear()
  })

  const api = (...answers: Route[]) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname
        if (path === '/api/auth/get-session')
          return json(session && { session: { id: 's' }, user: verifier, ...session })
        if (path === '/v1/recognitions')
          return json({ recognitionId, status: 'cached', transcriptionId: shown.id }, 201)
        if (path === `/v1/recognitions/${recognitionId}`)
          return json({ recognitionId, status: 'done', transcription: shown })
        if (path === '/v1/pages/lookup') return json({})
        if (path !== '/v1/explain') throw new TypeError(`no route for ${path}`)
        explains.push(JSON.parse(String(init?.body)))
        const answer = answers[explains.length - 1] ?? answers.at(-1)
        if (!answer) throw new TypeError('no answer')
        return answer(init)
      }),
    )
  }

  const held = () => {
    const pending: ((response: Response) => void)[] = []
    api(() => new Promise<Response>((resolve) => pending.push(resolve)))
    return async (index: number, response: Response) => {
      await act(async () => {
        pending[index]?.(response)
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
    }
  }

  const deliverFragment = async () => {
    await act(async () => {
      for (const listener of listeners)
        listener({ type: 'fragment', fragment, shelfmark }, { tab: { id: 1 } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
  }

  const openResult = async () => {
    currentPage = { type: 'page', shelfmark, scan: true, selecting: false }
    await act(async () => {
      root.render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await deliverFragment()
  }

  const chip = (text: string) =>
    [...container.querySelectorAll('main li button[aria-haspopup="dialog"]')].find(
      (button) => button.getAttribute('title') === text,
    )
  const sheet = () => container.querySelector('dialog[open]')
  const sheetButton = (text: string) =>
    [...(sheet()?.querySelectorAll('button') ?? [])].find((button) => button.textContent === text)
  const bar = () => sheet()?.querySelector('[role="status"]')

  const click = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
    await act(async () => {
      element.focus()
      element.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
  }

  const dispatch = async (target: Element | null | undefined, event: Event) => {
    if (!target) throw new Error('no target')
    await act(async () => {
      target.dispatchEvent(event)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    return event
  }

  const escape = () => dispatch(sheet(), new Event('cancel', { cancelable: true }))
  const pointerDown = (target: Element | null | undefined) =>
    dispatch(target, new MouseEvent('pointerdown', { bubbles: true }))
  const pointerUp = (target: Element | null | undefined) =>
    dispatch(target, new MouseEvent('pointerup', { bubbles: true }))
  const clickBackdrop = async (detail = 1) => {
    await pointerDown(sheet())
    await pointerUp(sheet())
    return dispatch(sheet(), new MouseEvent('click', { bubbles: true, detail }))
  }

  it('asks about the clicked chip and shows the answer with its sources, signed as retold', async () => {
    const answer = held()
    await openResult()

    await click(chip('крестьянинъ'))

    expect(explains).toEqual([
      { kind: 'term', text: 'крестьянинъ', context: { transcriptionId: shown.id } },
    ])
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(sheet()?.getAttribute('aria-labelledby')).toBe(sheet()?.querySelector('h2')?.id)
    expect(sheet()?.textContent).toContain('Пояснення терміна')
    expect(sheet()?.querySelector('h2')?.textContent).toBe('крестьянинъ')
    expect(sheet()?.querySelector('[aria-live="polite"]')?.textContent).toContain(
      'Шукаємо в довідковому корпусі…',
    )
    expect(chip('крестьянинъ')?.getAttribute('aria-expanded')).toBe('true')
    expect(chip('Борщаговки')?.getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(sheetButton('Закрити'))

    await answer(0, json(peasants))

    const text = sheet()?.textContent ?? ''
    expect(text).toContain('Селянин, особа сільського стану.')
    expect(text).not.toContain('Шукаємо')
    expect(text).not.toContain('частково')
    const sources = [...(sheet()?.querySelectorAll('li') ?? [])].map((item) => item.textContent)
    expect(sources).toEqual([
      '[1]Энциклопедический словарь Брокгауза и Ефрона, статья «Крестьяне»переказ статті · суспільне надбання',
      '[2]Словник української мовипереказ статті · суспільне надбання',
    ])
    expect(sheet()?.querySelector('a')?.getAttribute('href')).toBe(
      'https://ru.wikisource.org/wiki/ЭСБЕ/Крестьяне',
    )
    expect([...(sheet()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Закрити',
    ])
  })

  it.each([
    ['person', 'Іоаннъ Петровъ', 'entity'],
    ['place', 'Борщаговки', 'place'],
    ['date', '12 генваря 1884', 'date'],
  ] as const)('sends a %s chip as %s', async (_type, text, kind) => {
    api(() => json({ answer: null, reason: 'no_sources', citations: [] }))
    await openResult()
    await click(chip(text))

    expect(explains).toEqual([{ kind, text, context: { transcriptionId: shown.id } }])
  })

  it('asks about a date by its base form when the model gave one, and titles it by the chip', async () => {
    shown = {
      ...shown,
      entities: [
        { type: 'date', text: '12 генваря 1884', start: 28, end: 43, normalized: '12 января 1884' },
      ],
    }
    api(() => json({ answer: null, reason: 'no_sources', citations: [], date }))
    await openResult()
    await click(chip('12 генваря 1884'))

    expect(explains).toEqual([
      { kind: 'date', text: '12 января 1884', context: { transcriptionId: shown.id } },
    ])
    expect(sheet()?.querySelector('h2')?.textContent).toBe('12 генваря 1884')
  })

  it('offers no explanation for a chip the API would refuse', async () => {
    const long = 'а'.repeat(201)
    shown = {
      ...shown,
      normalizedText: `${lineText} ${long}`,
      entities: [...shown.entities, { type: 'term', text: long, start: 59, end: 260 }],
    }
    api(() => json(peasants))
    await openResult()

    expect(container.querySelector(`main li [title="${long}"]`)?.tagName).toBe('SPAN')
    expect(chip('крестьянинъ')).toBeDefined()
  })

  it('makes a low confidence visible next to the answer', async () => {
    api(() => json({ ...peasants, confidence: 'low' }))
    await openResult()
    await click(chip('крестьянинъ'))

    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
    expect(sheet()?.textContent).toContain('Джерела відповідають лише частково, звірте зі статтею')
  })

  it('says it does not know, without any invented text or sources', async () => {
    api(() => json({ answer: null, reason: 'no_sources', citations: [] }))
    await openResult()
    await click(chip('Борщаговки'))

    expect(sheet()?.textContent).toBe(
      'Пояснення топонімаБорщаговкиУ довідковому корпусі немає пояснення.Закрити',
    )
    expect(bar()).toBeNull()
  })

  it('shows a date in both calendars and its weekday', async () => {
    api(() => json({ answer: null, reason: 'no_sources', citations: [], date }))
    await openResult()
    await click(chip('12 генваря 1884'))

    const facts = sheet()?.querySelector('dl')
    expect(sheet()?.textContent).toContain('Пояснення дати')
    expect(facts?.textContent).toBe(
      'Дата12 січня 1884, ст. ст.24 січня 1884, н. ст.День тижнячетвер',
    )
    expect(sheet()?.textContent).toContain('У довідковому корпусі немає пояснення.')
  })

  it('shows the date without an explanation when the model is not available, and asks again next time', async () => {
    api(
      () => json({ answer: null, citations: [], date }),
      () => json({ answer: null, reason: 'no_sources', citations: [], date }),
    )
    await openResult()
    await click(chip('12 генваря 1884'))

    expect(sheet()?.textContent).toContain('Пояснення зараз недоступне.')
    expect(sheet()?.textContent).not.toContain('У довідковому корпусі')
    expect(sheet()?.querySelector('dl')?.textContent).toContain('24 січня 1884, н. ст.')

    await click(sheetButton('Закрити'))
    await click(chip('12 генваря 1884'))

    expect(explains).toHaveLength(2)
    expect(sheet()?.textContent).toContain('У довідковому корпусі немає пояснення.')
  })

  it('asks again after «не знаю», because one failed model run must not stick', async () => {
    api(
      () => json({ answer: null, reason: 'no_sources', citations: [] }),
      () => json(peasants),
    )
    await openResult()
    await click(chip('крестьянинъ'))
    expect(sheet()?.textContent).toContain('У довідковому корпусі немає пояснення.')

    await click(sheetButton('Закрити'))
    await click(chip('крестьянинъ'))

    expect(explains).toHaveLength(2)
    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
  })

  it('keeps an answer for the same chip instead of asking again', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))
    await click(sheetButton('Закрити'))
    await click(chip('крестьянинъ'))

    expect(explains).toHaveLength(1)
    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
  })

  it('keeps the answer after the result was left for the profile and opened again', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))
    await click(sheetButton('Закрити'))

    await click(container.querySelector('header button'))
    expect(chip('крестьянинъ')).toBeUndefined()
    await click(container.querySelector('header button'))
    await click(chip('крестьянинъ'))

    expect(explains).toHaveLength(1)
    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
  })

  it('waits for the request already sent when a chip is closed and opened again', async () => {
    const answer = held()
    await openResult()
    await click(chip('крестьянинъ'))
    await click(sheetButton('Закрити'))
    await click(chip('крестьянинъ'))

    expect(explains).toHaveLength(1)
    expect(sheet()?.textContent).toContain('Шукаємо в довідковому корпусі…')

    await answer(0, json(peasants))

    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
  })

  it('keeps an answer that arrived after its sheet was closed', async () => {
    const answer = held()
    await openResult()
    await click(chip('крестьянинъ'))
    await click(sheetButton('Закрити'))
    await answer(0, json(peasants))

    expect(sheet()).toBeNull()

    await click(chip('крестьянинъ'))

    expect(explains).toHaveLength(1)
    expect(sheet()?.textContent).toContain('Селянин, особа сільського стану.')
  })

  it('ignores an answer that arrives after another chip was opened', async () => {
    const answer = held()
    await openResult()

    await click(chip('крестьянинъ'))
    await click(sheetButton('Закрити'))
    await click(chip('Борщаговки'))
    await answer(0, json(peasants))

    expect(sheet()?.querySelector('h2')?.textContent).toBe('Борщаговки')
    expect(sheet()?.textContent).not.toContain('Селянин')
    expect(sheet()?.textContent).toContain('Шукаємо в довідковому корпусі…')
  })

  it.each([
    ['«Закрити»', async () => click(sheetButton('Закрити'))],
    ['Esc', escape],
    ['a click on the dimmed panel', () => clickBackdrop()],
  ])('closes with %s and returns focus to the chip', async (_case, close) => {
    api(() => json(peasants))
    await openResult()

    await click(chip('крестьянинъ'))
    expect(document.activeElement).toBe(sheetButton('Закрити'))
    await close()

    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(chip('крестьянинъ'))
    expect(chip('крестьянинъ')?.getAttribute('aria-expanded')).toBe('false')
  })

  it('stays open after a double click on the dimmed panel', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))

    await clickBackdrop(2)
    expect(sheet()).not.toBeNull()

    await pointerDown(sheet()?.querySelector('h2'))
    await pointerUp(sheet()?.querySelector('h2'))
    await dispatch(
      sheet()?.querySelector('h2'),
      new MouseEvent('click', { bubbles: true, detail: 1 }),
    )
    expect(sheet()).not.toBeNull()
  })

  it.each([
    ['from the answer onto the dimmed panel', 'h2', 'dialog'],
    ['from the dimmed panel onto the answer', 'dialog', 'h2'],
  ])('stays open when a selection is dragged %s', async (_case, from, to) => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))
    const at = (where: string) => (where === 'dialog' ? sheet() : sheet()?.querySelector(where))

    await pointerDown(at(from))
    await pointerUp(at(to))
    await dispatch(sheet(), new MouseEvent('click', { bubbles: true, detail: 1 }))

    expect(sheet()).not.toBeNull()
  })

  it('does not pull focus to «Закрити» when an error bar appears', async () => {
    const answer = held()
    await openResult()
    await click(chip('крестьянинъ'))
    act(() => sheetButton('Закрити')?.blur())

    await answer(0, failure(503, 'reader_unavailable', 'Пояснення тимчасово недоступне'))

    expect(bar()?.textContent).toContain('Пояснення тимчасово недоступне')
    expect(document.activeElement).toBe(document.body)
  })

  it('leaves focus where the reader put it when the panel re-renders for another reason', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))
    const link = sheet()?.querySelector('a')
    act(() => link?.focus())
    expect(document.activeElement).toBe(link)
    act(() => link?.blur())

    currentPage = { type: 'page', shelfmark, scan: true, selecting: false }
    await act(async () => {
      for (const listener of listeners) listener({ ...currentPage }, { tab: { id: 1 } })
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()

    expect(sheet()).not.toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('closes on Esc through the panel state, not by the browser alone', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))

    const cancel = await escape()

    expect(cancel.defaultPrevented).toBe(true)
    expect(sheet()).toBeNull()
    expect(container.querySelector('dialog')).toBeNull()
    expect(chip('крестьянинъ')?.getAttribute('aria-expanded')).toBe('false')
  })

  it.each([
    [400, 'bad_request', 'Некоректний запит'],
    [413, 'too_large', 'Запит завеликий'],
    [429, 'too_many_requests', 'Забагато запитів, спробуйте за хвилину'],
    [429, 'too_many_requests', 'Денний ліміт пояснень вичерпано, спробуйте завтра'],
  ])('offers only to close after %i «%s»', async (status, code, message) => {
    api(() => failure(status, code, message))
    await openResult()
    await click(chip('крестьянинъ'))

    expect(bar()?.textContent).toBe(`${message}Зрозуміло`)
    await click(bar()?.querySelector('button'))
    expect(sheet()).toBeNull()
    expect(explains).toHaveLength(1)
  })

  it.each([
    [503, 'reader_unavailable', 'Пояснення тимчасово недоступне'],
    [503, 'shutting_down', 'Сервер перезапускається'],
    [500, 'internal_error', 'Внутрішня помилка сервера'],
  ])(
    'offers to try again after %i %s, announces the answer and keeps focus in the sheet',
    async (status, code, message) => {
      api(
        () => failure(status, code, message),
        () => json(peasants),
      )
      await openResult()
      await click(chip('крестьянинъ'))

      expect(bar()?.textContent).toBe(`${message}Спробувати ще раз`)
      expect(sheet()?.querySelector('[aria-live] [role="status"]')).toBeNull()
      expect(sheet()?.textContent).not.toContain('Селянин')

      await click(bar()?.querySelector('button'))

      expect(explains).toHaveLength(2)
      expect(sheet()?.querySelector('[aria-live="polite"]')?.textContent).toContain(
        'Селянин, особа сільського стану.',
      )
      expect(bar()).toBeNull()
      expect(document.activeElement).toBe(sheetButton('Закрити'))
    },
  )

  it('says there is no network and offers to try again', async () => {
    api(() => Promise.reject(new TypeError('Failed to fetch')))
    await openResult()
    await click(chip('крестьянинъ'))

    expect(bar()?.textContent).toBe(
      'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз' + 'Спробувати ще раз',
    )
  })

  it('says the server did not answer in time, not that the network is lost', async () => {
    api(() => Promise.reject(new DOMException('signal timed out', 'TimeoutError')))
    await openResult()
    await click(chip('крестьянинъ'))

    expect(bar()?.textContent).toBe(
      'Сервер не відповів вчасно. Спробуйте ще раз' + 'Спробувати ще раз',
    )
  })

  it('does not open explanations while a line is being edited', async () => {
    api(() => json(peasants))
    await openResult()

    const line = [...container.querySelectorAll('main li button')].find((button) =>
      button.textContent?.includes('Села Борщаговки'),
    )
    await click(line)

    expect(container.querySelector('textarea')).not.toBeNull()
    expect(chip('крестьянинъ')).toBeUndefined()
    expect(container.querySelector('main li [title="крестьянинъ"]')?.tagName).toBe('SPAN')
  })

  it('does not open explanations while the confirmation card is open', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    session = { canVerify: true }
    api(() => json(peasants))
    await openResult()

    const confirm = [...container.querySelectorAll('main button')].find(
      (button) => button.textContent === 'Підтвердити',
    )
    await click(confirm)

    expect(container.querySelector('main section[role="group"]')).not.toBeNull()
    expect(chip('крестьянинъ')).toBeUndefined()
    expect(container.querySelector('main li [title="крестьянинъ"]')?.tagName).toBe('SPAN')
  })

  it('closes the sheet when another fragment is read', async () => {
    api(() => json(peasants))
    await openResult()
    await click(chip('крестьянинъ'))
    expect(sheet()).not.toBeNull()

    shown = nextTranscription()
    await deliverFragment()

    expect(container.textContent).toContain('Села Борщаговки')
    expect(sheet()).toBeNull()
    expect(chip('крестьянинъ')?.getAttribute('aria-expanded')).toBe('false')
  })
})

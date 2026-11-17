import type { Shelfmark, Transcription } from '@khronist/contracts'
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

const shelfmark = (image: number): Shelfmark => ({
  archive: 'ЦДІАК України',
  fond: '127',
  opys: '1078',
  sprava: '177',
  image,
  portal: 'archium',
})

const fragment: Fragment = {
  base64Png: 'iVBORw0KGgo=',
  imageHash: 'a'.repeat(64),
  box: { x: 0, y: 0, w: 1, h: 1 },
  width: 10,
  height: 10,
}

const transcription: Transcription = {
  id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 1,
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

const recognitionId = '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c'
const token = 'session-token.signature'
const user = { id: 'user-1', email: 'olena.k@khronist.example', name: '' }

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const deliver = async (message: unknown) => {
  await act(async () => {
    for (const listener of listeners) listener(message, { tab: { id: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

describe('citation (D1)', () => {
  let root: Root
  let container: HTMLElement

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await fakeStorage.local.set({ firstRunSeen: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    currentPage = undefined
    resetFakeStorage()
    vi.unstubAllGlobals()
  })

  const render = async () => {
    await act(async () => {
      root.render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  const click = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
    await act(async () => {
      element.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
  }

  const mainButton = (text: string) =>
    [...container.querySelectorAll('main button')].find((button) =>
      button.textContent?.startsWith(text),
    )

  const api = (routes: Record<string, (init?: RequestInit) => Response | Promise<Response>>) => {
    const calls: { path: string; authorization: string | null; body?: unknown }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname
        calls.push({
          path,
          authorization: new Headers(init?.headers).get('authorization'),
          ...(typeof init?.body === 'string' && { body: JSON.parse(init.body) as unknown }),
        })
        const route = routes[path]
        if (!route) throw new TypeError(`no route for ${path}`)
        return route(init)
      }),
    )
    return calls
  }

  const cited: Transcription = { ...transcription, shelfmark: shelfmark(4) }
  const dstu = 'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Зобр. 4.\nСела Борщаговки'
  const markdown = '[ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4](https://archium.example/4)'
  const texts: Record<string, string> = {
    'dstu:true': dstu,
    'dstu:false': 'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Зобр. 4.',
    'markdown:true': markdown,
  }
  const writeText = vi.fn<(text: string) => Promise<void>>()

  const citeBody = (init?: RequestInit) =>
    JSON.parse(String(init?.body)) as { format: string; withTranscription: boolean }
  const citeKey = (init?: RequestInit) => {
    const { format, withTranscription } = citeBody(init)
    return `${format}:${withTranscription}`
  }
  const citedText = (init?: RequestInit) => json({ text: texts[citeKey(init)] })

  const read = (
    cite: (init?: RequestInit) => Response | Promise<Response> = citedText,
    session: { user: typeof user; canVerify: boolean } | null = null,
    shown: Transcription = cited,
  ) =>
    api({
      '/api/auth/get-session': () => json(session && { session: { id: 's' }, ...session }),
      '/v1/recognitions': () =>
        json({ recognitionId, status: 'cached', transcriptionId: shown.id }, 201),
      [`/v1/recognitions/${recognitionId}`]: () =>
        json({ recognitionId, status: 'done', transcription: shown }),
      '/v1/cite': cite,
    })

  const openReading = async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await settle()
  }

  const sheet = () => container.querySelector('dialog')
  const preview = () => sheet()?.querySelector('pre')?.textContent
  const sheetButton = (text: string) =>
    [...(sheet()?.querySelectorAll('button') ?? [])].find((button) => button.textContent === text)
  const barButtons = () =>
    [...(mainButton('Цитата')?.parentElement?.children ?? [])].map((button) => button.textContent)
  const radio = (label: string) =>
    [...(sheet()?.querySelectorAll('label') ?? [])].find(
      (candidate) => candidate.textContent === label,
    )?.control
  const toggle = () => sheet()?.querySelector('[role="switch"]')
  const statusBar = () => sheet()?.querySelector('[role="status"]')
  const cites = (calls: ReturnType<typeof api>) =>
    calls.filter((call) => call.path === '/v1/cite').map((call) => call.body)
  const failing = (status: number, code: string, message: string) => () =>
    json({ error: { code, message } }, status)
  const pressEscape = () =>
    act(async () => {
      sheet()?.dispatchEvent(new Event('cancel', { cancelable: true }))
    })
  const pressOn = (
    pressed: Element | null | undefined,
    released: Element | null | undefined,
    clicked: Element | null | undefined,
    detail = 1,
  ) =>
    act(async () => {
      pressed?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
      released?.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }))
      clicked?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail }))
    })
  const fresh = (): Transcription => ({ ...cited, id: crypto.randomUUID() })
  const savedVersion = (): Transcription => ({
    ...cited,
    id: crypto.randomUUID(),
    version: 2,
    lines: [{ ...cited.lines[0]!, text: 'Села Борщагівки' }],
  })

  beforeEach(() => {
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'clipboard')
  })

  it('offers a citation after the main action, also to a guest, only with a shelfmark', async () => {
    read()
    await openReading()
    expect(mainButton('Цитата')?.className).toContain('btn-ghost')
    expect(barButtons()).toEqual(['Виділити фрагмент', 'Цитата', 'Спитати'])

    act(() => root.unmount())
    root = createRoot(container)
    read(citedText, null, transcription)
    await openReading()
    expect(container.textContent).toContain('Села Борщаговки')
    expect(mainButton('Цитата')).toBeUndefined()
  })

  it('puts the citation after the confirmation and before «Спитати», as in Figma', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    read(citedText, { user: { ...user, name: 'Олена К.' }, canVerify: true })
    await openReading()

    expect(barButtons()).toEqual(['Підтвердити', 'Цитата', 'Спитати', 'Виділити фрагмент'])
  })

  it('opens on the ДСТУ format with the transcription and shows the text of the API as is', async () => {
    const calls = read()
    await openReading()

    await click(mainButton('Цитата'))

    expect(sheet()?.textContent).toContain('Цитата')
    expect(cites(calls)).toEqual([
      { transcriptionId: cited.id, format: 'dstu', withTranscription: true },
    ])
    expect(radio('ДСТУ')).toHaveProperty('checked', true)
    expect(toggle()?.getAttribute('aria-checked')).toBe('true')
    expect(preview()).toBe(dstu)
    expect(document.activeElement).toBe(radio('ДСТУ'))
    expect(sheet()?.textContent).not.toContain('нотатник')
  })

  it('asks once for each format and toggle while the sheet is open', async () => {
    const calls = read()
    await openReading()
    await click(mainButton('Цитата'))

    await click(radio('Markdown'))
    expect(preview()).toBe(markdown)
    await click(radio('ДСТУ'))
    await click(toggle())
    expect(preview()).toBe(texts['dstu:false'])
    await click(toggle())
    expect(preview()).toBe(dstu)

    expect(cites(calls).map((body) => body && Object.values(body).slice(1))).toEqual([
      ['dstu', true],
      ['markdown', true],
      ['dstu', false],
    ])

    await pressEscape()
    await click(mainButton('Цитата'))
    expect(cites(calls)).toHaveLength(4)
  })

  it('says the citation is on the way and keeps the copy off until it comes', async () => {
    let answer: (response: Response) => void = () => undefined
    read(() => new Promise<Response>((resolve) => (answer = resolve)))
    await openReading()
    await click(mainButton('Цитата'))

    expect(sheet()?.textContent).toContain('Складаємо цитату…')
    expect(sheetButton('Скопіювати')).toHaveProperty('disabled', true)

    await act(async () => answer(json({ text: dstu })))
    await settle()
    expect(sheet()?.textContent).not.toContain('Складаємо цитату…')
    expect(sheetButton('Скопіювати')).toHaveProperty('disabled', false)
  })

  it('copies the shown text and says so until another text is shown', async () => {
    read()
    await openReading()
    await click(mainButton('Цитата'))

    await click(sheetButton('Скопіювати'))
    expect(writeText).toHaveBeenCalledWith(dstu)
    expect(sheetButton('Скопійовано')).toBeDefined()

    await click(radio('Markdown'))
    expect(sheetButton('Скопіювати')).toBeDefined()
  })

  it('says a copy failed, keeps the text to copy by hand and tries again', async () => {
    writeText.mockRejectedValueOnce(new DOMException('Document is not focused', 'NotAllowedError'))
    read()
    await openReading()
    await click(mainButton('Цитата'))

    await click(sheetButton('Скопіювати'))
    expect(statusBar()?.textContent).toContain(
      'Не вдалося скопіювати. Виділіть текст цитати й скопіюйте вручну',
    )
    expect(preview()).toBe(dstu)

    await click(sheetButton('Спробувати ще раз'))
    expect(writeText).toHaveBeenCalledTimes(2)
    expect(statusBar()).toBeNull()
    expect(sheetButton('Скопійовано')).toBeDefined()
  })

  it('says a copy failed when the panel has no clipboard at all', async () => {
    Reflect.deleteProperty(navigator, 'clipboard')
    read()
    await openReading()
    await click(mainButton('Цитата'))

    await click(sheetButton('Скопіювати'))
    expect(statusBar()?.textContent).toContain('Не вдалося скопіювати')
  })

  it.each([
    [400, 'bad_request', 'Некоректний запит'],
    [404, 'not_found', 'У фрагмента немає шифру, тож цитату скласти не можна'],
    [413, 'too_large', 'Запит завеликий'],
  ])(
    'shows %i with the server message and closes on «Зрозуміло»',
    async (status, code, message) => {
      const calls = read(failing(status, code, message), null, fresh())
      await openReading()
      await click(mainButton('Цитата'))

      expect(statusBar()?.textContent).toContain(message)
      expect(sheet()?.querySelector('pre')).toBeNull()
      expect(sheetButton('Скопіювати')).toHaveProperty('disabled', true)

      await click(sheetButton('Зрозуміло'))
      expect(sheet()).toBeNull()
      expect(cites(calls)).toHaveLength(1)
    },
  )

  it.each([
    [429, 'too_many_requests', 'Забагато запитів, спробуйте пізніше'],
    [500, 'internal_error', 'Внутрішня помилка сервера'],
    [503, 'shutting_down', 'Сервер перезапускається, спробуйте за кілька секунд'],
  ])(
    'offers a retry after %i and shows the citation once it comes',
    async (status, code, message) => {
      const cite = vi
        .fn<(init?: RequestInit) => Response>()
        .mockReturnValueOnce(failing(status, code, message)())
        .mockImplementation(citedText)
      read(cite)
      await openReading()
      await click(mainButton('Цитата'))

      expect(statusBar()?.textContent).toContain(message)
      await click(sheetButton('Спробувати ще раз'))

      expect(statusBar()).toBeNull()
      expect(preview()).toBe(dstu)
    },
  )

  it('says there is no connection and tries again, also on a switch back to the format', async () => {
    const cite = vi
      .fn<(init?: RequestInit) => Response>()
      .mockImplementationOnce(() => {
        throw new TypeError('Failed to fetch')
      })
      .mockImplementation(citedText)
    const calls = read(cite)
    await openReading()
    await click(mainButton('Цитата'))

    expect(statusBar()?.textContent).toContain('Немає зв’язку із сервером')
    await click(radio('Markdown'))
    expect(preview()).toBe(markdown)
    await click(radio('ДСТУ'))

    expect(preview()).toBe(dstu)
    expect(cites(calls)).toHaveLength(3)
  })

  it('calls an answer outside the contract unexpected', async () => {
    read(() => json({ citation: dstu }))
    await openReading()
    await click(mainButton('Цитата'))

    expect(statusBar()?.textContent).toContain('Сервер відповів неочікувано')
    expect(sheetButton('Спробувати ще раз')).toBeDefined()
  })

  it('closes the confirmation question when the citation opens', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    read(citedText, { user: { ...user, name: 'Олена К.' }, canVerify: true })
    await openReading()

    await click(mainButton('Підтвердити'))
    expect(container.querySelector('main section[role="group"]')).not.toBeNull()
    await click(mainButton('Цитата'))

    expect(container.querySelector('main section[role="group"]')).toBeNull()
    expect(sheet()).not.toBeNull()
  })

  it('closes on Esc and on a press outside and gives the focus back', async () => {
    read()
    await openReading()

    const button = mainButton('Цитата')
    if (button instanceof HTMLElement) button.focus()
    await click(button)
    expect(document.activeElement).not.toBe(button)
    const cancel = new Event('cancel', { cancelable: true })
    await act(async () => {
      sheet()?.dispatchEvent(cancel)
    })
    expect(cancel.defaultPrevented).toBe(true)
    expect(sheet()).toBeNull()
    expect(document.activeElement).toBe(mainButton('Цитата'))

    await click(mainButton('Цитата'))
    await pressOn(sheet(), sheet(), sheet())
    expect(sheet()).toBeNull()
  })

  it('stays open when a press starts inside the sheet, is a double click or a click inside', async () => {
    read()
    await openReading()
    await click(mainButton('Цитата'))

    const pre = () => sheet()?.querySelector('pre')
    await pressOn(pre(), sheet(), sheet())
    expect(sheet()).not.toBeNull()
    await pressOn(sheet(), pre(), sheet())
    expect(sheet()).not.toBeNull()
    await pressOn(sheet(), sheet(), sheet(), 2)
    expect(sheet()).not.toBeNull()
    await pressOn(sheet(), sheet(), pre(), 0)
    expect(sheet()).not.toBeNull()
  })

  it('leaves the focus where it is on a re-render that removes nothing focused', async () => {
    read()
    await openReading()
    await click(mainButton('Цитата'))
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()

    await click(sheetButton('Скопіювати'))

    expect(sheetButton('Скопійовано')).toBeDefined()
    expect(document.activeElement).toBe(document.body)
  })

  it('brings the focus back to the format when the focused retry goes away', async () => {
    const cite = vi
      .fn<(init?: RequestInit) => Response>()
      .mockReturnValueOnce(failing(429, 'too_many_requests', 'Забагато запитів')())
      .mockImplementation(citedText)
    read(cite)
    await openReading()
    await click(mainButton('Цитата'))
    const retry = sheetButton('Спробувати ще раз')
    if (retry instanceof HTMLElement) retry.focus()

    await click(retry)

    expect(preview()).toBe(dstu)
    expect(document.activeElement).toBe(radio('ДСТУ'))
  })

  it('opens as a modal dialog and closes it before it leaves the panel', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal')
    const close = vi.spyOn(HTMLDialogElement.prototype, 'close')
    read()
    await openReading()

    await click(mainButton('Цитата'))
    expect(showModal).toHaveBeenCalledTimes(1)
    expect(sheet()?.open).toBe(true)
    const dialog = sheet()
    await pressEscape()

    expect(close).toHaveBeenCalledTimes(1)
    expect(dialog?.open).toBe(false)
    showModal.mockRestore()
    close.mockRestore()
  })

  it('offers no citation while a line is open, since the citation is built from a saved version', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    read(citedText, { user, canVerify: false })
    await openReading()

    const line = [...container.querySelectorAll('main li button')].find((button) =>
      button.textContent?.includes('Села Борщаговки'),
    )
    await click(line)
    expect(container.querySelector('textarea')).not.toBeNull()
    expect(mainButton('Цитата')).toBeUndefined()
  })

  it('closes for good when the citation stops being possible while it is open', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    read(citedText, { user, canVerify: false })
    await openReading()
    await click(mainButton('Цитата'))

    const line = [...container.querySelectorAll('main li button')].find((button) =>
      button.textContent?.includes('Села Борщаговки'),
    )
    await click(line)
    expect(sheet()).toBeNull()
    await act(async () => {
      container
        .querySelector('textarea')
        ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    })
    await settle()

    expect(container.querySelector('textarea')).toBeNull()
    expect(mainButton('Цитата')).toBeDefined()
    expect(sheet()).toBeNull()
  })

  it('closes when another fragment is shown', async () => {
    const other: Transcription = {
      ...cited,
      id: '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
      lines: [{ ...cited.lines[0]!, text: 'Марія Григоріева' }],
    }
    const shown = [cited, other]
    api({
      '/api/auth/get-session': () => json(null),
      '/v1/recognitions': () =>
        json({ recognitionId, status: 'cached', transcriptionId: shown[0]!.id }, 201),
      [`/v1/recognitions/${recognitionId}`]: () =>
        json({ recognitionId, status: 'done', transcription: shown.shift() }),
      '/v1/cite': citedText,
    })
    await openReading()
    await click(mainButton('Цитата'))
    expect(sheet()).not.toBeNull()

    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await settle()

    expect(container.textContent).toContain('Марія Григоріева')
    expect(sheet()).toBeNull()
  })

  it.each([
    ['«Зрозуміло»', () => click(sheetButton('Зрозуміло'))],
    ['Esc', () => pressEscape()],
  ])('hides the citation of a fragment the API refused, closed with %s', async (_way, close) => {
    const refused = fresh()
    const calls = read(
      failing(404, 'not_found', 'У фрагмента немає шифру, тож цитату скласти не можна'),
      null,
      refused,
    )
    await openReading()
    const button = mainButton('Цитата')
    if (button instanceof HTMLElement) button.focus()
    await click(button)
    expect(statusBar()?.textContent).toContain('У фрагмента немає шифру')
    expect(mainButton('Цитата')).toBeDefined()

    await click(radio('Markdown'))
    await click(toggle())
    expect(cites(calls)).toHaveLength(1)
    expect(statusBar()?.textContent).toContain('У фрагмента немає шифру')

    await close()

    expect(sheet()).toBeNull()
    expect(mainButton('Цитата')).toBeUndefined()
    expect(document.activeElement).toBe(mainButton('Виділити фрагмент'))

    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await settle()
    expect(container.textContent).toContain('Села Борщаговки')
    expect(mainButton('Цитата')).toBeUndefined()
  })

  it('drops a refusal that comes after the sheet closed and stops its request', async () => {
    let answer: (response: Response) => void = () => undefined
    let signal: AbortSignal | null | undefined
    read(
      (init) => {
        signal = init?.signal
        return new Promise<Response>((resolve) => (answer = resolve))
      },
      null,
      fresh(),
    )
    await openReading()
    await click(mainButton('Цитата'))

    await pressEscape()
    expect(signal?.aborted).toBe(true)
    await act(async () => answer(failing(404, 'not_found', 'Не знайдено')()))
    await settle()

    expect(mainButton('Цитата')).toBeDefined()
  })

  it('keeps the citation after a failure a retry can fix', async () => {
    read(failing(429, 'too_many_requests', 'Забагато запитів, спробуйте пізніше'))
    await openReading()
    await click(mainButton('Цитата'))

    await pressEscape()

    expect(mainButton('Цитата')).toBeDefined()
  })

  it('keeps the citation off while a confirmation is on the way', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    await fakeStorage.local.set({ confirmWithoutAsking: true })
    let answer: (response: Response) => void = () => undefined
    api({
      '/api/auth/get-session': () =>
        json({ session: { id: 's' }, user: { ...user, name: 'Олена К.' }, canVerify: true }),
      '/v1/recognitions': () =>
        json({ recognitionId, status: 'cached', transcriptionId: cited.id }, 201),
      [`/v1/recognitions/${recognitionId}`]: () =>
        json({ recognitionId, status: 'done', transcription: cited }),
      [`/v1/transcriptions/${cited.id}/verify`]: () =>
        new Promise<Response>((resolve) => (answer = resolve)),
    })
    await openReading()
    await click(mainButton('Підтвердити'))

    expect(mainButton('Цитата')).toHaveProperty('disabled', true)
    await act(async () => answer(json({ ...cited, status: 'verified' })))
    await settle()
    expect(mainButton('Цитата')).toHaveProperty('disabled', false)
  })

  it.each([
    ['saved', () => json(savedVersion())],
    ['refused by the server', () => failing(500, 'internal_error', 'Внутрішня помилка сервера')()],
  ])(
    'leaves the focus alone when a line edit committed by leaving the field is %s',
    async (_outcome, answer) => {
      await fakeStorage.session.set({ sessionToken: token })
      api({
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
        '/v1/recognitions': () =>
          json({ recognitionId, status: 'cached', transcriptionId: cited.id }, 201),
        [`/v1/recognitions/${recognitionId}`]: () =>
          json({ recognitionId, status: 'done', transcription: cited }),
        [`/v1/transcriptions/${cited.id}/lines`]: answer,
        '/v1/cite': citedText,
      })
      await openReading()
      const line = [...container.querySelectorAll('main li button')].find((button) =>
        button.textContent?.includes('Села Борщаговки'),
      )
      await click(line)
      const field = container.querySelector('textarea')
      if (!field) throw new Error('no line is open')
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
          field,
          'Села Борщагівки',
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })

      await act(async () => {
        field.blur()
        field.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()

      expect(container.querySelector('textarea')).toBeNull()
      expect(document.activeElement).toBe(document.body)
    },
  )

  it('locks the format and the toggle once the API refused the citation', async () => {
    read(failing(404, 'not_found', 'Не знайдено'), null, fresh())
    await openReading()
    await click(mainButton('Цитата'))

    expect(radio('Markdown')).toHaveProperty('disabled', true)
    expect(radio('ДСТУ')).toHaveProperty('disabled', true)
    expect(toggle()).toHaveProperty('disabled', true)
  })

  it('keeps the format and the toggle usable after a failure a retry can fix', async () => {
    read(failing(429, 'too_many_requests', 'Забагато запитів'))
    await openReading()
    await click(mainButton('Цитата'))

    expect(radio('Markdown')).toHaveProperty('disabled', false)
    expect(toggle()).toHaveProperty('disabled', false)
  })

  it('toggles the transcription by its visible label too', async () => {
    const calls = read()
    await openReading()
    await click(mainButton('Цитата'))

    const label = [...(sheet()?.querySelectorAll('label') ?? [])].find(
      (candidate) => candidate.textContent === 'З транскрипцією',
    )
    await click(label)

    expect(toggle()?.getAttribute('aria-checked')).toBe('false')
    expect(cites(calls).at(-1)).toMatchObject({ withTranscription: false })
  })

  it('titles the sheet with a heading the dialog is named by', async () => {
    read()
    await openReading()
    await click(mainButton('Цитата'))

    const title = sheet()?.querySelector('h2')
    expect(title?.textContent).toBe('Цитата')
    expect(sheet()?.getAttribute('aria-labelledby')).toBe(title?.id)
  })

  const editFirstLine = async (text: string) => {
    const line = [...container.querySelectorAll('main li button')].find((button) =>
      button.textContent?.includes('Села Борщаговки'),
    )
    await click(line)
    const field = container.querySelector('textarea')
    if (!field) throw new Error('no line is open')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
        field,
        text,
      )
      field.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => {
      field.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    await settle()
  }

  it('offers no citation while an edit waits for the sign-in, since it is not saved yet', async () => {
    read()
    await openReading()

    await editFirstLine('Села Борщагівки')
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await settle()

    expect(container.textContent).toContain('Правки не збережено')
    expect(mainButton('Цитата')).toBeUndefined()
  })

  it('offers no citation while a failed save is shown, and again once the edit is dropped', async () => {
    await fakeStorage.session.set({ sessionToken: token })
    api({
      '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
      '/v1/recognitions': () =>
        json({ recognitionId, status: 'cached', transcriptionId: cited.id }, 201),
      [`/v1/recognitions/${recognitionId}`]: () =>
        json({ recognitionId, status: 'done', transcription: cited }),
      [`/v1/transcriptions/${cited.id}/lines`]: failing(400, 'bad_request', 'Некоректний запит'),
      '/v1/cite': citedText,
    })
    await openReading()

    await editFirstLine('Села Борщагівки')

    expect(container.textContent).toContain('Некоректний запит')
    expect(mainButton('Цитата')).toBeUndefined()
    await click(mainButton('Скасувати правки'))
    expect(mainButton('Цитата')).toBeDefined()
  })
})

import type { ChatResponse, Shelfmark, Transcription } from '@khronist/contracts'
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
        create: async () => undefined,
        sendMessage: async (_tabId: number, message: { type: string }) => {
          if (message.type === 'get-page' && currentPage) return currentPage
          if (message.type === 'get-page') throw new Error('no content script')
          return undefined
        },
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
        getAll: async () => [{ name: 'open-panel', shortcut: '' }],
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

const transcriptionOf = (id: string, regionId: string): Transcription => ({
  id,
  regionId,
  shelfmark,
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 1,
  status: 'draft',
  lines: [
    {
      idx: 0,
      text: 'Села Борщаговки крестьянинъ',
      box: { x: 0, y: 0, w: 1, h: 1 },
      boxSource: 'estimated',
      uncertain: false,
      words: [],
    },
  ],
  normalizedText: 'Села Борщаговки крестьянинъ',
  entities: [],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-14T12:00:00.000Z',
})

const first = transcriptionOf(
  '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
)
const second = transcriptionOf(
  '6a2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
  '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
)

const recognitionId = '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c'

const answered: ChatResponse = {
  answer: 'Восприємники — хрещені батьки [1]. Запис називає селянина [2].',
  confidence: 'high',
  citations: [
    {
      kind: 'chunk',
      chunkId: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
      sourceId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
      title: 'Восприемники',
      url: 'https://uk.wikisource.org/wiki/ЕСБЕ/Восприемники',
      licence: 'CC BY-SA 4.0',
      retelling: true,
      quote: 'хрещені батьки дитини',
    },
    { kind: 'record', transcriptionId: first.id, quote: 'Села Борщаговки крестьянинъ' },
  ],
  followups: ['Хто такі куми?', 'Де була Борщагівка?'],
}

const unknown: ChatResponse = {
  answer: null,
  reason: 'no_sources',
  citations: [],
  followups: ['Що таке метрична книга?'],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

type ChatCall = { messages: { role: string; content: string }[]; context?: unknown }

describe('ask tab', () => {
  let root: Root
  let container: HTMLElement
  let shown: Transcription
  let chatReplies: (() => Response | Promise<Response>)[]
  let chatCalls: ChatCall[]
  let otherCalls: string[]

  beforeEach(async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    await fakeStorage.local.set({ firstRunSeen: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    shown = first
    chatReplies = []
    chatCalls = []
    otherCalls = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = new URL(url).pathname
        if (path === '/api/auth/get-session')
          return json({
            session: { id: 's' },
            user: { id: 'u', email: 'reader@khronist.example', name: 'Олена К.' },
            canVerify: true,
          })
        if (path === '/v1/pages/lookup') return json({})
        if (path === '/v1/recognitions')
          return json({ recognitionId, status: 'cached', transcriptionId: shown.id }, 201)
        if (path.startsWith('/v1/recognitions/'))
          return json({ recognitionId, status: 'done', transcription: shown })
        if (path === '/v1/chat') {
          chatCalls.push(JSON.parse(String(init?.body)) as ChatCall)
          const reply = chatReplies.shift()
          if (!reply) throw new Error('no chat reply prepared')
          return reply()
        }
        otherCalls.push(`${init?.method ?? 'GET'} ${path}`)
        throw new TypeError(`no route for ${path}`)
      }),
    )
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    currentPage = undefined
    resetFakeStorage()
    vi.unstubAllGlobals()
  })

  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

  const render = async () => {
    await act(async () => {
      root.render(<App />)
    })
    await settle()
  }

  const deliver = async (message: unknown) => {
    await act(async () => {
      for (const listener of listeners) listener(message, { tab: { id: 1 } })
    })
    await settle()
    await settle()
  }

  const click = async (element: Element | null | undefined) => {
    if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
    await act(async () => element.click())
    await settle()
    await settle()
  }

  const tab = (name: string) =>
    [...container.querySelectorAll('[role="tab"]')].find((each) => each.textContent === name)
  const button = (text: string) =>
    [...container.querySelectorAll('button')].find((each) => each.textContent === text)
  const field = () => container.querySelector<HTMLInputElement>('input[aria-label="Запитання"]')
  const sendButton = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Надіслати"]')
  const statusBar = () => container.querySelector('[role="status"]')?.textContent ?? null

  const typeQuestion = async (question: string) => {
    const input = field()
    if (!input) throw new Error('no question field')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        input,
        question,
      )
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  const ask = async (question: string) => {
    await typeQuestion(question)
    await click(sendButton())
  }

  const submitComposer = async () => {
    await act(async () => {
      field()?.form?.requestSubmit()
    })
    await settle()
  }

  const pressKey = async (key: string) => {
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
  }

  const readFragment = async () => {
    currentPage = { type: 'page', shelfmark, scan: true, selecting: false }
    await deliver({ type: 'fragment', fragment, shelfmark })
  }

  it('shows only the reading and asking tabs, reading first', async () => {
    await render()

    const tabs = [...container.querySelectorAll('[role="tab"]')]
    expect(tabs.map((each) => each.textContent)).toEqual(['Читання', 'Спитати'])
    expect(tabs.map((each) => each.getAttribute('aria-selected'))).toEqual(['true', 'false'])
    expect(container.textContent).not.toContain('Нотатник')
  })

  it('hides the tabs on the account screen', async () => {
    await render()
    await click(container.querySelector('header button'))

    expect(container.querySelector('[role="tablist"]')).toBeNull()
  })

  it('asks without context when nothing is read and shows the sources of the answer', async () => {
    chatReplies.push(() => json(answered))
    await render()
    await click(tab('Спитати'))

    expect(container.textContent).toContain('Хроніст відповідає лише за джерелами')
    expect(container.textContent).not.toContain('Контекст:')
    expect(field()?.placeholder).toBe('Запитати про термін, дату чи місце…')
    expect(field()?.maxLength).toBe(2000)
    expect(sendButton()?.disabled).toBe(true)

    await ask('  Хто такі восприємники?  ')

    expect(chatCalls).toEqual([{ messages: [{ role: 'user', content: 'Хто такі восприємники?' }] }])
    expect(field()?.value).toBe('')
    const thread = container.querySelector('main ol')?.textContent ?? ''
    expect(thread).toContain('Хто такі восприємники?')
    expect(thread).toContain('Восприємники — хрещені батьки [1]. Запис називає селянина [2].')
    expect(thread).not.toContain('Джерела відповідають лише частково')
    const sources = [...container.querySelectorAll('ol[aria-label="Джерела"] li')]
    expect(sources.map((each) => each.textContent)).toEqual([
      '[1]Восприемникипереказ статті · CC BY-SA 4.0',
      '[2]«Села Борщаговки крестьянинъ»з транскрипції фрагмента',
    ])
    expect(sources[0]?.querySelector('a')?.getAttribute('href')).toBe(
      'https://uk.wikisource.org/wiki/ЕСБЕ/Восприемники',
    )
    expect(sources[1]?.querySelector('a')).toBeNull()
    expect(container.textContent).not.toContain('цитата')
  })

  it('asks a follow-up with the conversation so far', async () => {
    chatReplies.push(
      () => json(answered),
      () => json(unknown),
    )
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    const chips = [...container.querySelectorAll('ul[aria-label="Можна спитати далі"] button')]
    expect(chips.map((each) => each.textContent)).toEqual(['Хто такі куми?', 'Де була Борщагівка?'])

    await click(chips[0])

    expect(chatCalls[1]?.messages).toEqual([
      { role: 'user', content: 'Хто такі восприємники?' },
      { role: 'assistant', content: answered.answer },
      { role: 'user', content: 'Хто такі куми?' },
    ])
    expect(container.textContent).toContain(
      'У довідковому корпусі немає відповіді на це запитання.',
    )
    expect(container.textContent).not.toContain('Запропонувати джерело')
    const chipsAfter = [...container.querySelectorAll('ul[aria-label="Можна спитати далі"] button')]
    expect(chipsAfter.map((each) => each.textContent)).toEqual(['Що таке метрична книга?'])
  })

  it('shows that the sources answer only partly', async () => {
    chatReplies.push(() => json({ ...answered, confidence: 'low' }))
    await render()
    await click(tab('Спитати'))
    await ask('Якого віросповідання вони були?')

    expect(container.textContent).toContain('Джерела відповідають лише частково')
  })

  it('shows the waiting state and blocks another question until the answer', async () => {
    let answer: (response: Response) => void = () => {}
    chatReplies.push(
      () => json(answered),
      () => new Promise<Response>((resolve) => (answer = resolve)),
    )
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')
    await ask('А куми?')

    expect(container.textContent).toContain('Шукаю відповідь у джерелах…')
    expect(container.querySelector('ul[aria-label="Можна спитати далі"]')).toBeNull()
    await typeQuestion('А хрещені батьки?')
    expect(field()?.value).toBe('А хрещені батьки?')
    expect(sendButton()?.disabled).toBe(true)
    await submitComposer()
    expect(chatCalls).toHaveLength(2)

    await act(async () => answer(json(unknown)))
    await settle()

    expect(container.textContent).not.toContain('Шукаю відповідь у джерелах…')
    expect(container.textContent).toContain('У довідковому корпусі немає відповіді')
  })

  it('drops a late answer about the previous fragment', async () => {
    let answer: (response: Response) => void = () => {}
    chatReplies.push(() => new Promise<Response>((resolve) => (answer = resolve)))
    await render()
    await readFragment()
    await click(tab('Спитати'))
    await ask('Хто тут записаний?')

    shown = second
    await readFragment()
    await click(tab('Спитати'))
    await act(async () => answer(json(answered)))
    await settle()

    expect(container.textContent).not.toContain('Хто тут записаний?')
    expect(container.textContent).not.toContain('Восприємники — хрещені батьки')
    expect(container.textContent).not.toContain('Шукаю відповідь у джерелах…')
    expect(field()?.value).toBe('Хто тут записаний?')
  })

  it('keeps the conversation when the reader turns the page', async () => {
    chatReplies.push(() => json(answered))
    await render()
    await readFragment()
    await click(tab('Спитати'))
    await ask('Хто тут записаний?')

    currentPage = {
      type: 'page',
      shelfmark: { ...shelfmark, image: 5 },
      scan: true,
      selecting: false,
    }
    await deliver(currentPage)

    expect(container.textContent).not.toContain('Контекст:')
    expect(container.textContent).toContain('Хто тут записаний?')
    expect(container.textContent).toContain('Восприємники — хрещені батьки')

    currentPage = { type: 'page', shelfmark, scan: true, selecting: false }
    await deliver({ type: 'fragment', fragment, shelfmark })
    await click(tab('Спитати'))

    expect(container.textContent).toContain('Хто тут записаний?')
  })

  it('shows the reading tab and locks the tabs while the reader selects a fragment', async () => {
    await render()
    await click(tab('Спитати'))
    currentPage = { type: 'page', shelfmark, scan: true, selecting: true }
    await deliver(currentPage)

    expect(tab('Читання')?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('Обведіть запис на аркуші')
    await click(tab('Спитати'))
    expect(tab('Читання')?.getAttribute('aria-selected')).toBe('true')
    expect((tab('Спитати') as HTMLButtonElement).disabled).toBe(true)

    currentPage = { type: 'page', shelfmark, scan: true, selecting: false }
    await deliver(currentPage)

    expect((tab('Спитати') as HTMLButtonElement).disabled).toBe(false)
  })

  it('follows the tabs pattern: one tab in the tab order, arrows switch, each panel is labelled', async () => {
    await render()
    const read = tab('Читання') as HTMLElement
    const askTab = tab('Спитати') as HTMLElement
    const panels = [...container.querySelectorAll('[role="tabpanel"]')]

    expect(panels).toHaveLength(2)
    expect(container.querySelector('main')?.getAttribute('role')).toBeNull()
    expect(read.tabIndex).toBe(0)
    expect(askTab.tabIndex).toBe(-1)
    for (const [index, each] of [read, askTab].entries()) {
      const panel = panels[index]
      expect(each.getAttribute('aria-controls')).toBe(panel?.id)
      expect(panel?.getAttribute('aria-labelledby')).toBe(each.id)
    }
    expect(panels.map((panel) => (panel as HTMLElement).hidden)).toEqual([false, true])

    await act(async () => read.focus())
    await pressKey('ArrowRight')
    await settle()

    expect(document.activeElement).toBe(askTab)
    expect(askTab.getAttribute('aria-selected')).toBe('true')
    expect(askTab.tabIndex).toBe(0)
    expect(panels.map((panel) => (panel as HTMLElement).hidden)).toEqual([true, false])

    await pressKey('ArrowRight')
    await settle()
    expect(document.activeElement).toBe(read)

    await pressKey('End')
    await settle()
    expect(document.activeElement).toBe(askTab)
    await pressKey('Home')
    await settle()
    expect(read.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps the reading panel, its scroll and the confirm card across a round trip to the chat', async () => {
    await fakeStorage.session.set({ sessionToken: 'session-token.signature' })
    await render()
    await readFragment()
    await click(button('Підтвердити'))
    const card = container.querySelector('[role="group"]')
    const scroller = container.querySelector<HTMLElement>('main .overflow-y-auto')
    if (!scroller) throw new Error('no scrolling result')
    scroller.scrollTop = 120

    expect(card).not.toBeNull()
    await click(tab('Спитати'))
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    await click(tab('Читання'))

    expect(container.querySelector('main .overflow-y-auto')).toBe(scroller)
    expect(scroller.scrollTop).toBe(120)
    expect(container.querySelector('[role="group"]')).toBe(card)
  })

  it('keeps the focus on the reading tab after a keyboard round trip past an open confirm card', async () => {
    await fakeStorage.session.set({ sessionToken: 'session-token.signature' })
    await render()
    await readFragment()
    await click(button('Підтвердити'))
    await act(async () => (tab('Читання') as HTMLElement).focus())

    await pressKey('ArrowRight')
    await settle()
    await pressKey('ArrowLeft')
    await settle()

    expect(document.activeElement).toBe(tab('Читання'))
    await pressKey('Enter')
    await settle()
    expect(otherCalls.filter((call) => call.endsWith('/verify'))).toEqual([])
    expect(container.querySelector('[role="group"]')).not.toBeNull()
  })

  it.each(['Читання', 'Спитати'])(
    'keeps the open confirm card and the result when the page turns on the %s tab',
    async (name) => {
      await fakeStorage.session.set({ sessionToken: 'session-token.signature' })
      await render()
      await readFragment()
      await click(button('Підтвердити'))
      await click(tab(name))

      currentPage = {
        type: 'page',
        shelfmark: { ...shelfmark, image: 5 },
        scan: true,
        selecting: false,
      }
      await deliver(currentPage)
      await click(tab('Читання'))

      expect(container.querySelector('[role="group"]')).not.toBeNull()
      expect(container.textContent).toContain('Села Борщаговки крестьянинъ')
    },
  )

  it('moves the focus to the question field from the result action bar', async () => {
    await render()
    await readFragment()
    const action = container.querySelector<HTMLElement>('main div.border-t button:last-child')
    await act(async () => action?.focus())
    await click(action)

    expect(document.activeElement).toBe(field())
  })

  it('sends one request when the reader sends twice before the panel updates', async () => {
    chatReplies.push(
      () => json(answered),
      () => json(answered),
    )
    await render()
    await click(tab('Спитати'))
    await typeQuestion('Хто такі восприємники?')
    await act(async () => {
      sendButton()?.click()
      sendButton()?.click()
    })
    await settle()

    expect(chatCalls).toHaveLength(1)
  })

  it('keeps a conversation started before any reading when the first fragment is read', async () => {
    chatReplies.push(() => json(answered))
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')
    await readFragment()
    await click(tab('Спитати'))

    expect(container.textContent).toContain('Хто такі восприємники?')
    expect(container.textContent).toContain('Контекст: зобр. 4, 1 рядок прочитано')
  })

  it('keeps the focus in the question field after sending and after a follow-up', async () => {
    chatReplies.push(
      () => json({ ...answered, followups: ['Хто такі куми?', 'Хто такі куми?'] }),
      () => json(unknown),
    )
    const errors = vi.spyOn(console, 'error')
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
    expect(document.activeElement).toBe(field())
    const chips = [...container.querySelectorAll('ul[aria-label="Можна спитати далі"] button')]
    expect(chips.map((each) => each.textContent)).toEqual(['Хто такі куми?', 'Хто такі куми?'])

    await act(async () => (chips[1] as HTMLElement).focus())
    expect(document.activeElement).toBe(chips[1])
    await click(chips[1])

    expect(document.activeElement).toBe(field())
  })

  it('announces the thread from one live region and keeps the question node when the answer comes', async () => {
    let answer: (response: Response) => void = () => {}
    chatReplies.push(() => new Promise<Response>((resolve) => (answer = resolve)))
    await render()
    await click(tab('Спитати'))
    const live = container.querySelector('[aria-live="polite"]')

    expect(live?.textContent).toContain('Хроніст відповідає лише за джерелами')
    await ask('Хто такі восприємники?')
    expect(container.querySelector('[aria-live="polite"]')).toBe(live)
    const question = [...(live?.querySelectorAll('li') ?? [])].find(
      (item) => item.textContent === 'Хто такі восприємники?',
    )

    await act(async () => answer(json(answered)))
    await settle()

    expect(container.querySelector('[aria-live="polite"]')).toBe(live)
    expect(question?.isConnected).toBe(true)
    expect(live?.textContent).toContain('Восприємники — хрещені батьки')
  })

  it('sends the read fragment as context and lets the reader switch it off', async () => {
    chatReplies.push(
      () => json(answered),
      () => json(answered),
    )
    await render()
    await readFragment()
    await click(tab('Спитати'))

    expect(container.textContent).toContain('Контекст: зобр. 4, 1 рядок прочитано')
    expect(field()?.placeholder).toBe('Запитати про цей аркуш…')
    await ask('Хто тут записаний?')
    expect(chatCalls[0]?.context).toEqual({ transcriptionId: first.id })

    const toggle = container.querySelector('[role="switch"]')
    expect(toggle?.getAttribute('aria-checked')).toBe('true')
    await click(toggle)
    expect(toggle?.getAttribute('aria-checked')).toBe('false')
    await ask('А що таке восприємники?')

    expect(chatCalls[1]?.context).toBeUndefined()
  })

  it('opens the asking tab from the result action bar', async () => {
    await render()
    await readFragment()

    await click(container.querySelector('main div.border-t button:last-child'))

    expect(tab('Спитати')?.getAttribute('aria-selected')).toBe('true')
    expect(container.textContent).toContain('Контекст: зобр. 4, 1 рядок прочитано')
  })

  it('keeps the conversation across tabs and starts a new one for a new fragment', async () => {
    chatReplies.push(() => json(answered))
    await render()
    await readFragment()
    await click(tab('Спитати'))
    await ask('Хто тут записаний?')
    await click(tab('Читання'))
    await click(tab('Спитати'))

    expect(container.textContent).toContain('Хто тут записаний?')

    shown = second
    await readFragment()
    expect(tab('Читання')?.getAttribute('aria-selected')).toBe('true')
    await click(tab('Спитати'))

    expect(container.textContent).not.toContain('Хто тут записаний?')
    expect(container.textContent).toContain('Хроніст відповідає лише за джерелами')
  })

  it.each([
    [503, 'reader_unavailable', 'Чат тимчасово недоступний'],
    [500, 'internal_error', 'Внутрішня помилка'],
  ])('offers to retry after %i and answers on the retry', async (status, code, message) => {
    chatReplies.push(
      () => json({ error: { code, message } }, status),
      () => json(answered),
    )
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    expect(statusBar()).toBe(`${message}Спробувати ще раз`)
    expect(field()?.value).toBe('Хто такі восприємники?')
    expect(container.querySelector('main ol')).toBeNull()

    await click(button('Спробувати ще раз'))

    expect(chatCalls).toHaveLength(2)
    expect(chatCalls[1]).toEqual(chatCalls[0])
    expect(statusBar()).toBeNull()
    expect(field()?.value).toBe('')
    expect(container.textContent).toContain('Восприємники — хрещені батьки')
  })

  it('offers to retry when the server is unreachable', async () => {
    chatReplies.push(() => Promise.reject(new TypeError('Failed to fetch')))
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    expect(statusBar()).toBe(
      'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз' + 'Спробувати ще раз',
    )
  })

  it('offers to retry when the answer is outside the contract', async () => {
    chatReplies.push(() => json({ answer: 'так' }))
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    expect(statusBar()).toBe('Сервер відповів неочікувано. Спробуйте ще раз' + 'Спробувати ще раз')
  })

  it('shows the limit after 429 and keeps the question for later', async () => {
    chatReplies.push(() =>
      json(
        {
          error: {
            code: 'too_many_requests',
            message: 'Денний ліміт запитань чату вичерпано, спробуйте завтра',
          },
        },
        429,
      ),
    )
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')

    expect(statusBar()).toBe('Денний ліміт запитань чату вичерпано, спробуйте завтраЗрозуміло')
    await click(button('Зрозуміло'))

    expect(statusBar()).toBeNull()
    expect(chatCalls).toHaveLength(1)
    expect(field()?.value).toBe('Хто такі восприємники?')
  })

  it.each([
    [400, 'bad_request', 'Некоректний запит'],
    [413, 'too_large', 'Запит завеликий'],
  ])('starts a new conversation after %i', async (status, code, message) => {
    chatReplies.push(
      () => json(answered),
      () => json({ error: { code, message } }, status),
    )
    await render()
    await click(tab('Спитати'))
    await ask('Хто такі восприємники?')
    await ask('А куми?')

    expect(statusBar()).toBe(
      'Не вдалося надіслати запитання з цією розмовою. Почніть новуПочати нову розмову',
    )
    await click(button('Почати нову розмову'))

    expect(statusBar()).toBeNull()
    expect(container.textContent).not.toContain('Хто такі восприємники?')
    expect(field()?.value).toBe('А куми?')
  })
})

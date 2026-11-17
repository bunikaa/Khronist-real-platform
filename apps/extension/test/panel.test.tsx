import type { Shelfmark, Transcription } from '@khronist/contracts'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fragment, PageMessage } from '../messages.ts'

type Listener = (message: unknown, sender: { tab?: { id?: number } }) => void
type CommandListener = (command: string, tab?: { id?: number }) => void

const listeners = new Set<Listener>()
const commandListeners = new Set<CommandListener>()
const sent: unknown[] = []
const opened: string[] = []
let currentPage: PageMessage | undefined
let assignedShortcut = ''

vi.mock('wxt/browser', async () => {
  const { fakeStorage } = await import('./fake-storage.ts')
  return {
    browser: {
      storage: fakeStorage,
      tabs: {
        query: async () => [{ id: 1 }],
        create: async ({ url }: { url: string }) => {
          opened.push(url)
        },
        sendMessage: async (_tabId: number, message: { type: string }) => {
          sent.push(message)
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
        getAll: async () => [{ name: 'open-panel', shortcut: assignedShortcut }],
        onCommand: {
          addListener: (listener: CommandListener) => commandListeners.add(listener),
          removeListener: (listener: CommandListener) => commandListeners.delete(listener),
        },
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

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

const deliver = async (message: unknown) => {
  await act(async () => {
    for (const listener of listeners) listener(message, { tab: { id: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('side panel', () => {
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
    commandListeners.clear()
    sent.length = 0
    opened.length = 0
    currentPage = undefined
    assignedShortcut = ''
    resetFakeStorage()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const render = async () => {
    await act(async () => {
      root.render(<App />)
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('tells the user to open the viewer when no content script answers', async () => {
    await render()
    expect(container.textContent).toContain('Відкрийте скан на підтримуваному порталі')
    expect(container.querySelector('main [role="tabpanel"]:not([hidden]) button')).toBeNull()
  })

  it('offers no selection on a portal page without a scan', async () => {
    currentPage = { type: 'page', shelfmark: null, scan: false, selecting: false }
    await render()
    expect(container.textContent).toContain('Відкрийте скан на підтримуваному порталі')
    expect(container.querySelector('main [role="tabpanel"]:not([hidden]) button')).toBeNull()
  })

  it('offers to select a fragment when the shelfmark is not recognized', async () => {
    currentPage = { type: 'page', shelfmark: null, scan: true, selecting: false }
    await render()
    expect(container.textContent).toContain('Виділити фрагмент')
    expect(container.textContent).toContain('Натисніть кнопку нижче, потім обведіть')
  })

  it('goes back to the new sheet when another image opens after a result', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({}))
        .mockResolvedValueOnce(
          json({ recognitionId, status: 'cached', transcriptionId: transcription.id }, 201),
        )
        .mockResolvedValueOnce(json({ recognitionId, status: 'done', transcription })),
    )
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    expect(container.textContent).toContain('Села Борщаговки')

    await deliver({ type: 'page', shelfmark: shelfmark(5), scan: true, selecting: false })

    expect(container.textContent).not.toContain('Села Борщаговки')
    expect(container.textContent).toContain('Виділіть фрагмент скану')
    expect(container.querySelector('header')?.textContent).toContain('зобр. 5')
  })

  it('keeps the lines of the fragment when a tab without a scan opens', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({}))
        .mockResolvedValueOnce(
          json({ recognitionId, status: 'cached', transcriptionId: transcription.id }, 201),
        )
        .mockResolvedValueOnce(json({ recognitionId, status: 'done', transcription })),
    )
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await deliver({ type: 'page', shelfmark: null, scan: false, selecting: false })

    expect(container.textContent).toContain('Села Борщаговки')
    expect(container.querySelector('header')?.textContent).toContain('зобр. 4')
  })

  it('shows the warnings of the model next to the lines', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({}))
        .mockResolvedValueOnce(
          json({ recognitionId, status: 'cached', transcriptionId: transcription.id }, 201),
        )
        .mockResolvedValueOnce(
          json({
            recognitionId,
            status: 'done',
            transcription: { ...transcription, warnings: ['cut_off_right'] },
          }),
        ),
    )
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    expect(container.textContent).toContain('Виділення обрізає текст праворуч')
  })

  it('cancels the selection on Esc pressed inside the panel', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: true }
    await render()
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(sent).toContainEqual({ type: 'cancel-selection' })
  })

  it('keeps a running reading when a new selection misses the scan', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    )
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await deliver({ type: 'fragment-failed', reason: 'outside', shelfmark: shelfmark(4) })
    expect(container.textContent).toContain('Читання рукопису')
    expect(container.textContent).not.toContain('Виділення не потрапило на скан')
  })

  it('shows why a selection could not be cut instead of going quiet', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    await render()
    await deliver({ type: 'fragment-failed', reason: 'crop', shelfmark: shelfmark(4) })
    expect(container.textContent).toContain('Не вдалося вирізати фрагмент зі скану')
    expect(container.querySelector('header')?.textContent).toContain('зобр. 4')
  })

  describe('account', () => {
    const email = 'olena.k@khronist.example'
    const token = 'session-token.signature'
    const user = { id: 'user-1', email, name: '' }
    const missingPage = 'Відкрийте скан на підтримуваному порталі'

    const settle = () =>
      act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

    const click = async (element: Element | null | undefined) => {
      if (!(element instanceof HTMLElement)) throw new Error('nothing to click')
      await act(async () => {
        element.click()
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
    }

    const accountButton = () => container.querySelector('header button')
    const mainButton = (text: string) =>
      [...container.querySelectorAll('main button')].find((button) =>
        button.textContent?.startsWith(text),
      )

    const type = async (label: string, value: string) => {
      const field = [...container.querySelectorAll('label')].find(
        (candidate) => candidate.textContent === label,
      )?.control
      if (!(field instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
          field,
          value,
        )
        field.dispatchEvent(new Event('input', { bubbles: true }))
      })
    }

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

    it('greets on the first run only once and lets the reader start without signing in', async () => {
      await fakeStorage.local.remove('firstRunSeen')
      await render()

      expect(container.textContent).toContain('Почати без входу')
      expect(container.textContent).toContain('Вхід потрібен лише для правок і підтвердження.')
      expect(container.textContent).not.toContain('searcharchives')
      expect(container.textContent).not.toContain('Гаряча клавіша')

      await click(mainButton('Почати без входу'))

      expect(container.textContent).toContain(missingPage)
      expect(fakeStorage.local.items.get('firstRunSeen')).toBe(true)
    })

    it('opens the sign-in from the first run', async () => {
      await fakeStorage.local.remove('firstRunSeen')
      await render()

      await click(mainButton('Увійти'))

      expect(container.textContent).toContain('Надішлемо код для входу')
      expect(accountButton()?.getAttribute('aria-pressed')).toBe('true')
    })

    it('signs in with the code from the email and goes back to reading', async () => {
      const calls = api({
        '/api/auth/email-otp/send-verification-otp': () => json({ success: true }),
        '/api/auth/sign-in/email-otp': () => json({ token: 'x' }, 200, { 'set-auth-token': token }),
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
      })
      await render()
      expect(accountButton()?.getAttribute('aria-label')).toBe('Увійти')

      await click(accountButton())
      await type('Електронна пошта', email)
      await click(mainButton('Надіслати код'))

      expect(container.textContent).toContain(`Код надіслано на ${email}`)
      expect(container.textContent).toContain('Надіслати ще раз через 1:00')

      await type('Код із листа', '123456')
      await click(mainButton('Увійти'))

      expect(calls.map((call) => call.path)).toEqual([
        '/api/auth/email-otp/send-verification-otp',
        '/api/auth/sign-in/email-otp',
        '/api/auth/get-session',
      ])
      expect(calls[1]?.body).toEqual({ email, otp: '123456' })
      expect(calls[2]?.authorization).toBe(`Bearer ${token}`)
      expect(container.textContent).toContain(missingPage)
      expect(accountButton()?.getAttribute('aria-label')).toBe('Профіль')
    })

    it('shows the error of a wrong code and keeps the code step', async () => {
      api({
        '/api/auth/email-otp/send-verification-otp': () => json({ success: true }),
        '/api/auth/sign-in/email-otp': () =>
          json({ error: { code: 'invalid_otp', message: 'Невірний код' } }, 400),
      })
      await render()
      await click(accountButton())
      await type('Електронна пошта', email)
      await click(mainButton('Надіслати код'))
      await type('Код із листа', '000000')

      await click(mainButton('Увійти'))

      expect(container.textContent).toContain('Невірний код')
      expect(container.textContent).toContain('Код із листа')
      expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
    })

    it('shows the profile, saves the signature, opens the shortcut settings and signs out', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      let name = ''
      const calls = api({
        '/api/auth/get-session': () =>
          json({ session: { id: 's' }, user: { ...user, name }, canVerify: false }),
        '/api/auth/update-user': (init) => {
          name = (JSON.parse(String(init?.body)) as { name: string }).name
          return json({ status: true })
        },
        '/api/auth/sign-out': () => json({ success: true }),
      })
      await render()

      await click(accountButton())
      expect(container.textContent).toContain(email)
      expect(container.textContent).toContain('Підпис не задано')
      expect(container.textContent).not.toContain('аркушів підтверджено')

      await click(mainButton('Підпис підтверджень'))
      await type('Підпис підтверджень', 'Олена К.')
      await click(mainButton('Зберегти'))

      expect(name).toBe('Олена К.')
      expect(container.querySelector('main')?.textContent).toContain('Олена К.')
      expect(mainButton('Зберегти')).toBeUndefined()

      await click(mainButton('Гаряча клавіша'))
      expect(opened).toEqual(['chrome://extensions/shortcuts'])

      await click(mainButton('Вийти'))

      expect(calls.at(-1)).toMatchObject({
        path: '/api/auth/sign-out',
        authorization: `Bearer ${token}`,
      })
      expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
      expect(container.textContent).toContain(missingPage)
      expect(accountButton()?.getAttribute('aria-label')).toBe('Увійти')
    })

    it('goes back to reading on Esc and on a second press of the account button', async () => {
      await render()
      await click(accountButton())
      expect(container.textContent).toContain('Надішлемо код для входу')

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      expect(container.textContent).toContain(missingPage)

      await click(accountButton())
      await click(accountButton())
      expect(container.textContent).toContain(missingPage)
    })

    const pressCommand = async (tabId = 1) => {
      await act(async () => {
        for (const listener of commandListeners) listener('open-panel', { id: tabId })
        await new Promise((resolve) => setTimeout(resolve, 0))
      })
      await settle()
    }

    const field = (label: string) =>
      [...container.querySelectorAll('label')].find((candidate) => candidate.textContent === label)
        ?.control as HTMLInputElement | null | undefined

    it('locks the address while the code is pending and resends to the same address', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      const calls = api({
        '/api/auth/email-otp/send-verification-otp': () => json({ success: true }),
      })
      await render()
      await click(accountButton())
      await type('Електронна пошта', email)
      await click(mainButton('Надіслати код'))

      expect(field('Електронна пошта')?.readOnly).toBe(true)
      expect((mainButton('Надіслати код') as HTMLButtonElement).disabled).toBe(true)

      for (let second = 0; second < 60; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
      }
      await type('Код із листа', '12')
      await click(mainButton('Надіслати ще раз'))

      expect(calls.map((call) => call.body)).toEqual([
        { email, type: 'sign-in' },
        { email, type: 'sign-in' },
      ])
      expect(field('Код із листа')?.value).toBe('')
      expect(container.textContent).toContain('Надіслати ще раз через 1:00')

      await click(mainButton('Інша адреса'))

      expect(field('Електронна пошта')?.readOnly).toBe(false)
      expect(container.textContent).not.toContain('Код із листа')
    })

    it('keeps only the digits of a pasted message with the code', async () => {
      api({ '/api/auth/email-otp/send-verification-otp': () => json({ success: true }) })
      await render()
      await click(accountButton())
      await type('Електронна пошта', email)
      await click(mainButton('Надіслати код'))

      await type('Код із листа', 'Ваш код входу в Хроніст: 123456. Він діє 5 хвилин')

      expect(field('Код із листа')?.value).toBe('123456')
      expect((mainButton('Увійти') as HTMLButtonElement).disabled).toBe(false)
    })

    it('ignores the hotkey pressed in another window', async () => {
      currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
      await render()
      await click(accountButton())

      await pressCommand(2)

      expect(sent).not.toContainEqual({ type: 'start-selection' })
      expect(accountButton()?.getAttribute('aria-pressed')).toBe('true')
    })

    it('keeps the signature editor in place while the save is on the way', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      api({
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
        '/api/auth/update-user': () => new Promise<Response>(() => {}),
      })
      await render()
      await click(accountButton())
      await click(mainButton('Підпис підтверджень'))
      await type('Підпис підтверджень', 'Олена К.')

      await click(mainButton('Зберегти'))

      expect((mainButton('Скасувати') as HTMLButtonElement).disabled).toBe(true)
      expect((mainButton('Підпис підтверджень') as HTMLButtonElement).disabled).toBe(true)
    })

    it('keeps the other-address button off while a resend is on the way', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true })
      let sends = 0
      api({
        '/api/auth/email-otp/send-verification-otp': () => {
          sends += 1
          return sends === 1 ? json({ success: true }) : new Promise<Response>(() => {})
        },
      })
      await render()
      await click(accountButton())
      await type('Електронна пошта', email)
      await click(mainButton('Надіслати код'))
      for (let second = 0; second < 60; second += 1) {
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
      }

      await click(mainButton('Надіслати ще раз'))

      expect((mainButton('Інша адреса') as HTMLButtonElement).disabled).toBe(true)
      expect(field('Електронна пошта')?.readOnly).toBe(true)
    })

    it('closes the account view when the hotkey starts a selection', async () => {
      currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
      await render()
      await click(accountButton())

      await pressCommand()

      expect(sent).toContainEqual({ type: 'start-selection' })
      expect(accountButton()?.getAttribute('aria-pressed')).toBe('false')
      expect(container.textContent).not.toContain('Надішлемо код для входу')
    })

    it('leaves the first run when the hotkey starts a selection', async () => {
      await fakeStorage.local.remove('firstRunSeen')
      await render()

      await pressCommand()

      expect(container.textContent).not.toContain('Почати без входу')
      expect(fakeStorage.local.items.get('firstRunSeen')).toBe(true)
    })

    it('closes only the account view on Esc while a selection is running', async () => {
      currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: true }
      await render()
      await click(accountButton())

      await act(async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(accountButton()?.getAttribute('aria-pressed')).toBe('false')
      expect(sent).not.toContainEqual({ type: 'cancel-selection' })
    })

    it('refuses a blank signature without asking the API', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      const calls = api({
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
      })
      await render()
      await click(accountButton())
      await click(mainButton('Підпис підтверджень'))

      await type('Підпис підтверджень', '   ')
      await click(mainButton('Зберегти'))

      expect(container.textContent).toContain('Підпис — від 1 до 80 символів')
      expect(field('Підпис підтверджень')?.getAttribute('aria-invalid')).toBe('true')
      expect(calls.some((call) => call.path === '/api/auth/update-user')).toBe(false)
    })

    it('goes back to the sign-in when the session expired while saving the signature', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      api({
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
        '/api/auth/update-user': () =>
          json({ error: { code: 'unauthorized', message: 'Потрібен вхід' } }, 401),
      })
      await render()
      await click(accountButton())
      await click(mainButton('Підпис підтверджень'))
      await type('Підпис підтверджень', 'Олена К.')

      await click(mainButton('Зберегти'))

      expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
      expect(container.textContent).toContain('Надішлемо код для входу')
      expect(accountButton()?.getAttribute('aria-label')).toBe('Увійти')
    })

    it('goes back to reading at once on sign-out, without waiting for the API', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      api({
        '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
        '/api/auth/sign-out': () => new Promise<Response>(() => {}),
      })
      await render()
      await click(accountButton())

      await click(mainButton('Вийти'))

      expect(container.textContent).toContain(missingPage)
      expect(container.textContent).not.toContain('Надішлемо код для входу')
      expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
    })

    it('closes the account view when a fragment arrives from the page', async () => {
      currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
      await render()
      await click(accountButton())

      await deliver({ type: 'fragment-failed', reason: 'outside', shelfmark: shelfmark(4) })

      expect(accountButton()?.getAttribute('aria-pressed')).toBe('false')
      expect(container.textContent).toContain('Виділення не потрапило на скан')
    })

    it('keeps the address read-only while the code is being sent', async () => {
      api({
        '/api/auth/email-otp/send-verification-otp': () => new Promise<Response>(() => {}),
      })
      await render()
      await click(accountButton())
      await type('Електронна пошта', email)

      await click(mainButton('Надіслати код'))

      expect(field('Електронна пошта')?.readOnly).toBe(true)
    })

    it('shows a hotkey changed in Chrome when the panel gets focus again', async () => {
      await fakeStorage.session.set({ sessionToken: token })
      api({ '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }) })
      await render()
      await click(accountButton())
      expect(container.textContent).toContain('Не призначено')

      assignedShortcut = 'Alt+Shift+K'
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

      expect(container.textContent).toContain('Alt + Shift + K')
    })

    describe('line editing', () => {
      const edited: Transcription = {
        ...transcription,
        lines: [
          ...transcription.lines,
          { ...transcription.lines[0]!, idx: 1, text: 'Коваленко и законная' },
        ],
      }
      const linesPath = `/v1/transcriptions/${edited.id}/lines`
      const newer = (text: string, version = 2): Transcription => ({
        ...edited,
        id: '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
        version,
        lines: [{ ...edited.lines[0]!, text }, edited.lines[1]!],
      })

      const read = (routes: Parameters<typeof api>[0] = {}) =>
        api({
          '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
          '/v1/recognitions': () =>
            json({ recognitionId, status: 'cached', transcriptionId: edited.id }, 201),
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({ recognitionId, status: 'done', transcription: edited }),
          ...routes,
        })

      const openReading = async () => {
        currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
        await render()
        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
      }

      const lineButton = (text: string) =>
        [...container.querySelectorAll('main li button')].find((button) =>
          button.textContent?.includes(text),
        )
      const editor = () => container.querySelector('textarea')

      const write = async (value: string) => {
        const field = editor()
        if (!field) throw new Error('no line is open')
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
            field,
            value,
          )
          field.dispatchEvent(new Event('input', { bubbles: true }))
        })
      }

      const press = async (key: string) => {
        await act(async () => {
          editor()?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await settle()
      }

      const saves = (calls: ReturnType<typeof api>) =>
        calls.filter((call) => call.path === linesPath)

      const enterToTheEnd = async () => {
        await press('Enter')
        await press('Enter')
      }

      it('sends a series of lines in one request once the last open line is left', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({ [linesPath]: () => json(newer('Села Борщаговки крестьянинъ')) })
        await openReading()

        await click(lineButton('Села Борщаговки'))
        expect(container.textContent).toContain('ви редагуєте')
        expect(container.textContent).toContain('Enter — наступний рядок · Esc — відміна')
        expect(editor()?.value).toBe('Села Борщаговки')

        await write('Села Борщаговки крестьянинъ')
        await press('Enter')

        expect(editor()?.getAttribute('aria-label')).toBe('Рядок 2')
        expect(saves(calls)).toEqual([])

        await write('Коваленко и законная жена')
        await press('Enter')

        expect(editor()).toBeNull()
        expect(saves(calls)).toEqual([
          {
            path: linesPath,
            authorization: `Bearer ${token}`,
            body: {
              baseVersion: 1,
              lines: [
                { idx: 0, text: 'Села Борщаговки крестьянинъ' },
                { idx: 1, text: 'Коваленко и законная жена' },
              ],
            },
          },
        ])
        expect(lineButton('Села Борщаговки крестьянинъ')?.textContent).toContain('(виправлено)')
      })

      it('sends the open series when a new fragment arrives', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const another = {
          ...edited,
          id: '9d4f0a3e-6c2d-4f6e-9a65-4e3f9d2b1c33',
          regionId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
        }
        let readings = 0
        const calls = read({
          [linesPath]: () => json(newer('Села Борщаговки крестьянинъ')),
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({
              recognitionId,
              status: 'done',
              transcription: (readings += 1) === 1 ? edited : another,
            }),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await settle()

        expect(saves(calls)).toEqual([
          expect.objectContaining({
            body: { baseVersion: 1, lines: [{ idx: 0, text: 'Села Борщаговки крестьянинъ' }] },
          }),
        ])
      })

      it('sends nothing for an unchanged line or after Esc', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read()
        await openReading()

        await click(lineButton('Села Борщаговки'))
        await press('Enter')
        await write('Коваленко и законная жена')
        await press('Escape')

        expect(editor()).toBeNull()
        expect(saves(calls)).toEqual([])
        expect(lineButton('Коваленко и законная')?.textContent).not.toContain('виправлено')
        expect(container.textContent).not.toContain('ви редагуєте')
      })

      it('inserts an old letter where the caret is', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read()
        await openReading()
        await click(lineButton('Села Борщаговки'))
        editor()?.setSelectionRange(4, 4)

        await click(container.querySelector('[aria-label="Вставити ѣ"]'))

        expect(editor()?.value).toBe('Селаѣ Борщаговки')
        expect(editor()?.selectionStart).toBe(5)
      })

      it('asks a guest to sign in and saves the line once a session appears', async () => {
        const calls = read({ [linesPath]: () => json(newer('Села Борщаговки крестьянинъ')) })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await press('Enter')
        expect(container.textContent).not.toContain('Надішлемо код для входу')

        await press('Enter')

        expect(container.textContent).toContain('Надішлемо код для входу')
        expect(saves(calls)).toEqual([])

        await click(accountButton())
        expect(container.textContent).toContain('Правки не збережено: щоб зберегти їх, увійдіть')
        expect(lineButton('Села Борщаговки крестьянинъ')).toBeDefined()

        await act(async () => {
          await fakeStorage.session.set({ sessionToken: token })
        })
        await settle()

        expect(saves(calls)).toHaveLength(1)
        expect(container.textContent).not.toContain('Правки не збережено')
      })

      it('shows the entities as chips under the text and hides them while an edit is unsaved', async () => {
        const withEntities: Transcription = {
          ...edited,
          entities: [
            { type: 'place', text: 'Борщаговки', start: 5, end: 15 },
            { type: 'person', text: 'Коваленко', start: 16, end: 25 },
            { type: 'place', text: 'Борщаговки', start: 40, end: 50 },
          ],
        }
        await fakeStorage.session.set({ sessionToken: token })
        read({
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({ recognitionId, status: 'done', transcription: withEntities }),
          [linesPath]: () => new Promise<Response>(() => undefined),
        })
        await openReading()

        const chips = () =>
          [...container.querySelectorAll('main li [title]')].map((chip) => chip.textContent)
        expect(container.textContent).toContain('Сутності')
        expect(chips()).toEqual(['Місце: Борщаговки', 'Особа: Коваленко'])

        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()

        expect(container.textContent).not.toContain('Сутності')
        expect(chips()).toEqual([])
      })

      it('has no entities section when the model found none', async () => {
        read()
        await openReading()

        expect(container.textContent).toContain('Села Борщаговки')
        expect(container.textContent).not.toContain('Сутності')
      })

      describe('conflict of edits (E4)', () => {
        const twoMinutesAgo = () => new Date(Date.now() - 2 * 60_000 - 5_000).toISOString()
        const theirs = (lines: [string, string]): Transcription => ({
          ...newer(lines[0], 2),
          lines: [
            { ...edited.lines[0]!, text: lines[0] },
            { ...edited.lines[1]!, text: lines[1] },
          ],
          author: { name: 'Андрій М.' },
          createdAt: twoMinutesAgo(),
        })
        const conflictWith = (current: Transcription) => () =>
          json(
            {
              error: { code: 'version_conflict', message: 'Транскрипцію вже змінили' },
              current,
            },
            409,
          )
        const card = () => container.querySelector('main section[aria-label="Порівняти"]')
        const cardButton = (text: string) =>
          [...(card()?.querySelectorAll('button') ?? [])].find(
            (button) => button.textContent === text,
          )

        it('shows both versions of a line both readers changed and keeps mine', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщагівки, змінено іншим', 'Коваленко и законная'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          const calls = read({
            [linesPath]: conflictWith(current),
            [currentPath]: () =>
              json({ ...current, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', version: 3 }),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()

          expect(container.querySelector('[role="status"]')?.textContent).toContain(
            'Поки ви редагували, рядок 01 змінив(ла) Андрій М.',
          )
          expect(container.querySelector('main section > span')?.textContent).toBe(
            'спірне · рядок 01',
          )
          expect(container.querySelectorAll('main li button')).toHaveLength(0)
          expect(card()).toBeNull()

          await click(container.querySelector('[role="status"] button'))

          expect(card()?.textContent).toContain('Рядок 01 · дві версії')
          expect(card()?.textContent).toContain('ВашаСела Борщаговки крестьянинъ')
          expect(card()?.textContent).toContain(
            'Андрій М. · 2 хв томуСела Борщагівки, змінено іншим',
          )

          await click(cardButton('Залишити моє'))

          expect(card()).toBeNull()
          expect(container.querySelector('[role="status"]')).toBeNull()
          expect(calls.filter((call) => call.path === currentPath)).toEqual([
            {
              path: currentPath,
              authorization: `Bearer ${token}`,
              body: { baseVersion: 2, lines: [{ idx: 0, text: 'Села Борщаговки крестьянинъ' }] },
            },
          ])
        })

        it('keeps the line being typed when a conflict comes back and checks it too', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщаговки', 'Коваленко и законная, змінено іншим'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          let answer: (response: Response) => void = () => undefined
          const calls = read({
            [linesPath]: () =>
              new Promise<Response>((resolve) => {
                answer = resolve
              }),
            [currentPath]: () =>
              json({ ...current, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', version: 3 }),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()
          await click(lineButton('Коваленко и законная'))
          await write('Коваленко и законная жена его')

          await act(async () => {
            answer(conflictWith(current)())
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
          await settle()

          expect(editor()).toBeNull()
          expect(container.querySelector('[role="status"]')?.textContent).toContain(
            'Поки ви редагували, рядок 02 змінив(ла) Андрій М.',
          )
          await click(container.querySelector('[role="status"] button'))
          expect(card()?.textContent).toContain('ВашаКоваленко и законная жена его')

          await click(cardButton('Залишити моє'))

          expect(calls.filter((call) => call.path === currentPath)[0]?.body).toEqual({
            baseVersion: 2,
            lines: [
              { idx: 0, text: 'Села Борщаговки крестьянинъ' },
              { idx: 1, text: 'Коваленко и законная жена его' },
            ],
          })
        })

        it('closes an untouched open line on a conflict and shows the newer text', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщаговки', 'Коваленко и законная, змінено іншим'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          let answer: (response: Response) => void = () => undefined
          const calls = read({
            [linesPath]: () =>
              new Promise<Response>((resolve) => {
                answer = resolve
              }),
            [currentPath]: () =>
              json({ ...current, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', version: 3 }),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()
          await click(lineButton('Коваленко и законная'))

          await act(async () => {
            answer(conflictWith(current)())
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
          await settle()

          expect(editor()).toBeNull()
          expect(container.querySelector('[role="status"]')).toBeNull()
          expect(container.textContent).toContain('Коваленко и законная, змінено іншим')
          expect(calls.filter((call) => call.path === currentPath)[0]?.body).toEqual({
            baseVersion: 2,
            lines: [{ idx: 0, text: 'Села Борщаговки крестьянинъ' }],
          })
        })

        it('leaves a line the other reader did not touch open while the edit moves over', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const three: Transcription = {
            ...edited,
            lines: [...edited.lines, { ...edited.lines[0]!, idx: 2, text: 'оба православнаго' }],
          }
          const current: Transcription = {
            ...three,
            id: '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
            version: 2,
            lines: [
              three.lines[0]!,
              { ...three.lines[1]!, text: 'Коваленко, змінено іншим' },
              three.lines[2]!,
            ],
            author: { name: 'Андрій М.' },
          }
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          let answer: (response: Response) => void = () => undefined
          const calls = api({
            '/api/auth/get-session': () => json({ session: { id: 's' }, user, canVerify: false }),
            '/v1/recognitions': () =>
              json({ recognitionId, status: 'cached', transcriptionId: three.id }, 201),
            [`/v1/recognitions/${recognitionId}`]: () =>
              json({ recognitionId, status: 'done', transcription: three }),
            [linesPath]: () =>
              new Promise<Response>((resolve) => {
                answer = resolve
              }),
            [currentPath]: () =>
              json({ ...current, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', version: 3 }),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await press('Enter')
          await press('Enter')
          await press('Enter')
          await click(lineButton('оба православнаго'))
          await write('оба православнаго исповѣданія')
          expect(saves(calls)).toHaveLength(1)

          await act(async () => {
            answer(conflictWith(current)())
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
          await settle()

          expect(container.querySelector('[role="status"]')).toBeNull()
          expect(editor()?.value).toBe('оба православнаго исповѣданія')
          expect(container.textContent).toContain('Коваленко, змінено іншим')
          expect(calls.filter((call) => call.path === currentPath)).toHaveLength(0)

          await press('Enter')

          expect(calls.filter((call) => call.path === currentPath)[0]?.body).toEqual({
            baseVersion: 2,
            lines: [
              { idx: 0, text: 'Села Борщаговки крестьянинъ' },
              { idx: 2, text: 'оба православнаго исповѣданія' },
            ],
          })
        })

        it('drops an edit the reader took back when the other reader rewrote the same line', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщагівки, змінено іншим', 'Коваленко и законная'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          let answer: (response: Response) => void = () => undefined
          const calls = read({
            [linesPath]: () =>
              new Promise<Response>((resolve) => {
                answer = resolve
              }),
            [currentPath]: () => json(current),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки')

          await act(async () => {
            answer(conflictWith(current)())
            await new Promise((resolve) => setTimeout(resolve, 0))
          })
          await settle()

          expect(editor()).toBeNull()
          expect(container.querySelector('[role="status"]')).toBeNull()
          expect(container.textContent).toContain('Села Борщагівки, змінено іншим')
          expect(calls.filter((call) => call.path === currentPath)).toEqual([])
        })

        it('stays on the lines while one is open when another image opens', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          read()
          await openReading()
          await click(lineButton('Села Борщаговки'))

          await deliver({ type: 'page', shelfmark: shelfmark(5), scan: true, selecting: false })

          expect(editor()?.value).toBe('Села Борщаговки')
          expect(container.querySelector('header')?.textContent).toContain('зобр. 4')
        })

        it('takes the other version and drops only the line in conflict', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщагівки, змінено іншим', 'Коваленко и законная'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          const calls = read({ [linesPath]: conflictWith(current) })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()
          await click(container.querySelector('[role="status"] button'))

          await click(cardButton('Прийняти чуже'))

          expect(card()).toBeNull()
          expect(container.textContent).toContain('Села Борщагівки, змінено іншим')
          expect(container.textContent).not.toContain('крестьянинъ')
          expect(calls.filter((call) => call.path === currentPath)).toEqual([])
          expect(lineButton('Села Борщагівки')).toBeDefined()
        })

        it('moves the edit onto the newer version when the other reader changed other lines', async () => {
          await fakeStorage.session.set({ sessionToken: token })
          const current = theirs(['Села Борщаговки', 'Коваленко и законная жена его'])
          const currentPath = `/v1/transcriptions/${current.id}/lines`
          const calls = read({
            [linesPath]: conflictWith(current),
            [currentPath]: () =>
              json({ ...current, id: '1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a', version: 3 }),
          })
          await openReading()
          await click(lineButton('Села Борщаговки'))
          await write('Села Борщаговки крестьянинъ')
          await enterToTheEnd()
          await settle()

          expect(container.querySelector('[role="status"]')).toBeNull()
          expect(calls.filter((call) => call.path === currentPath)).toEqual([
            {
              path: currentPath,
              authorization: `Bearer ${token}`,
              body: { baseVersion: 2, lines: [{ idx: 0, text: 'Села Борщаговки крестьянинъ' }] },
            },
          ])
          expect(container.textContent).toContain('Коваленко и законная жена его')
        })
      })

      it('keeps the edit when the session expired and opens the sign-in', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({
          [linesPath]: () =>
            json({ error: { code: 'unauthorized', message: 'Потрібен вхід' } }, 401),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await enterToTheEnd()

        expect(fakeStorage.session.items.has('sessionToken')).toBe(false)
        expect(container.textContent).toContain('Надішлемо код для входу')
        await click(accountButton())
        expect(lineButton('Села Борщаговки крестьянинъ')).toBeDefined()
      })

      it('shows the message of a failed save and retries it', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        let answers = 0
        const calls = read({
          [linesPath]: () =>
            (answers += 1) === 1
              ? json(
                  {
                    error: {
                      code: 'too_many_requests',
                      message: 'Забагато запитів, спробуйте пізніше',
                    },
                  },
                  429,
                )
              : json(newer('Села Борщаговки крестьянинъ')),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()

        expect(container.textContent).toContain('Забагато запитів, спробуйте пізніше')

        await click(mainButton('Спробувати ще раз'))

        expect(saves(calls)).toHaveLength(2)
        expect(container.textContent).not.toContain('Забагато запитів')
      })

      it('opens a clicked line at once and keeps the edit of the one that was open', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({ [linesPath]: () => json(newer('Села Борщаговки крестьянинъ')) })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await click(lineButton('Коваленко и законная'))

        expect(editor()?.getAttribute('aria-label')).toBe('Рядок 2')
        expect(lineButton('Села Борщаговки крестьянинъ')).toBeDefined()
        expect(saves(calls)).toHaveLength(0)

        await press('Escape')

        expect(saves(calls)).toHaveLength(1)
      })

      it('asks a guest to sign in only for the first unsaved edit', async () => {
        read()
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()
        await click(accountButton())

        await click(lineButton('Коваленко и законная'))
        await write('Коваленко и законная жена')
        await press('Enter')

        expect(container.textContent).not.toContain('Надішлемо код для входу')
        expect(container.textContent).toContain('Правки не збережено')
      })

      it('hides the modern spelling that no longer matches an unsaved edit', async () => {
        const words = (text: string) =>
          text.split(' ').map((word) => ({ text: word, uncertain: false }))
        read({
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({
              recognitionId,
              status: 'done',
              transcription: {
                ...edited,
                normalizedLines: [
                  { text: 'Села Борщагівки', words: words('Села Борщагівки') },
                  { text: 'Коваленко і законна', words: words('Коваленко і законна') },
                ],
              },
            }),
        })
        await openReading()
        expect(container.textContent).toContain('Сучасною орфографією')

        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()
        await click(accountButton())

        expect(container.textContent).not.toContain('Сучасною орфографією')
      })

      it('sends a rejected edit once and waits for the sign-in', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({
          [linesPath]: () =>
            json({ error: { code: 'unauthorized', message: 'Потрібен вхід' } }, 401),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await enterToTheEnd()
        await settle()

        expect(saves(calls)).toHaveLength(1)
      })

      it('leaves the lines as text while a conflict waits for the reader', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({
          [linesPath]: () =>
            json(
              {
                error: { code: 'version_conflict', message: 'Транскрипцію вже змінили' },
                current: newer('Села Борщаговки, змінено іншим'),
              },
              409,
            ),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()

        expect(container.querySelectorAll('main li')).toHaveLength(2)
        expect(container.textContent).toContain('Коваленко и законная')
        expect(container.querySelectorAll('main li button')).toHaveLength(0)
      })

      it('offers to drop an edit the API refuses instead of retrying it forever', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({
          [linesPath]: () =>
            json({ error: { code: 'bad_request', message: 'Некоректний запит' } }, 400),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()
        expect(mainButton('Спробувати ще раз')).toBeUndefined()

        await click(mainButton('Скасувати правки'))

        expect(saves(calls)).toHaveLength(1)
        expect(container.textContent).not.toContain('Некоректний запит')
        expect(container.textContent).not.toContain('крестьянинъ')
      })

      const leave = async (to: Element | null) => {
        await act(async () => {
          editor()?.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: to }))
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await settle()
      }

      it('saves the line when focus leaves it and keeps it open for the old letters', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({ [linesPath]: () => json(newer('Села Борщаговки крестьянинъ')) })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await leave(container.querySelector('[aria-label="Вставити ѣ"]'))
        expect(editor()).not.toBeNull()
        expect(saves(calls)).toHaveLength(0)

        const next = lineButton('Коваленко и законная')
        if (!next) throw new Error('no next line')
        await leave(next)
        expect(editor()).toBeNull()
        expect(saves(calls)).toHaveLength(1)
      })

      it('keeps the focus in the field when another line is pressed', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read()
        await openReading()
        await click(lineButton('Села Борщаговки'))

        const pressDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
        lineButton('Коваленко и законная')?.dispatchEvent(pressDown)

        expect(pressDown.defaultPrevented).toBe(true)
      })

      it('offers a retry when the API rejects a token that another window replaced', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({
          [linesPath]: async () => {
            await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
            return json({ error: { code: 'unauthorized', message: 'Потрібен вхід' } }, 401)
          },
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')

        await enterToTheEnd()
        await settle()

        expect(container.textContent).toContain('Потрібен вхід')
        expect(mainButton('Спробувати ще раз')).toBeDefined()
      })

      it('keeps the line open on Enter that confirms an input method candidate', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read()
        await openReading()
        await click(lineButton('Села Борщаговки'))

        await act(async () => {
          editor()?.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true }),
          )
        })

        expect(editor()?.getAttribute('aria-label')).toBe('Рядок 1')
      })

      it('sends the series again once the reader signs in after the session expired', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        let answers = 0
        const calls = read({
          [linesPath]: () =>
            (answers += 1) === 1
              ? json({ error: { code: 'unauthorized', message: 'Потрібен вхід' } }, 401)
              : json(newer('Села Борщаговки крестьянинъ')),
        })
        await openReading()
        await click(lineButton('Села Борщаговки'))
        await write('Села Борщаговки крестьянинъ')
        await enterToTheEnd()
        expect(container.textContent).toContain('Надішлемо код для входу')

        await act(async () => {
          await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
        })
        await settle()

        expect(saves(calls)).toHaveLength(2)
        expect(saves(calls)[1]?.authorization).toBe('Bearer newer-token.signature')
      })
    })

    describe('confirming', () => {
      const olena = { ...user, name: 'Олена К.' }
      const two: Transcription = {
        ...transcription,
        shelfmark: shelfmark(4),
        lines: [
          ...transcription.lines,
          { ...transcription.lines[0]!, idx: 1, text: 'Коваленко и законная' },
        ],
      }
      const verifyPath = `/v1/transcriptions/${two.id}/verify`
      const confirmed = (at = new Date().toISOString()): Transcription => ({
        ...two,
        status: 'verified',
        verifiedBy: { name: 'Олена К.' },
        verifiedSignature: 'Олена К.',
        verifiedAt: at,
      })

      const read = (
        session: { user: typeof user; canVerify: boolean } | null,
        routes: Parameters<typeof api>[0] = {},
        shown: Transcription = two,
      ) =>
        api({
          '/api/auth/get-session': () => json(session && { session: { id: 's' }, ...session }),
          '/v1/recognitions': () =>
            json({ recognitionId, status: 'cached', transcriptionId: shown.id }, 201),
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({ recognitionId, status: 'done', transcription: shown }),
          ...routes,
        })

      const openReading = async () => {
        currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
        await render()
        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await settle()
      }

      const remount = () => {
        act(() => root.unmount())
        root = createRoot(container)
      }

      const dialog = () => container.querySelector('main section[role="group"]')
      const dialogButton = (text: string) =>
        [...(dialog()?.querySelectorAll('button') ?? [])].find(
          (button) => button.textContent === text,
        )
      const badge = () => container.querySelector('main section > span')
      const statusBar = () => container.querySelector('[role="status"]')
      const verifies = (calls: ReturnType<typeof api>) =>
        calls.filter((call) => call.path === verifyPath)
      const failing = (status: number, code: string, message: string) => () =>
        json({ error: { code, message } }, status)

      it('offers no confirmation to a guest or to an account outside the verifier list', async () => {
        read(null)
        await openReading()
        expect(badge()?.textContent).toBe('чернетка моделі')
        expect(container.textContent).toContain('ще ніхто не підтвердив')
        expect(mainButton('Підтвердити')).toBeUndefined()
        expect(mainButton('Виділити фрагмент')?.className).toContain('btn-primary')

        remount()
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: false })
        await openReading()
        expect(container.textContent).toContain('Села Борщаговки')
        expect(mainButton('Підтвердити')).toBeUndefined()
      })

      it('asks first and confirms with the signature of the account', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read(
          { user: olena, canVerify: true },
          { [verifyPath]: () => json(confirmed()) },
        )
        await openReading()
        expect(mainButton('Виділити фрагмент')?.className).toContain('btn-ghost')

        await click(mainButton('Підтвердити'))

        expect(dialog()?.textContent).toContain('Підтвердити 2 рядки як прочитані вами?')
        expect(dialog()?.textContent).toContain(
          'Текст стане публічним під CC BY 4.0 з підписом «Олена К.».',
        )
        expect(verifies(calls)).toEqual([])

        await click(dialogButton('Підтвердити'))

        expect(verifies(calls)).toEqual([
          { path: verifyPath, authorization: `Bearer ${token}`, body: { signature: 'Олена К.' } },
        ])
        expect(dialog()).toBeNull()
        expect(badge()?.textContent).toBe('підтверджено · Олена К. · сьогодні')
        expect(container.textContent).not.toContain('ще ніхто не підтвердив')
        expect(container.textContent).not.toContain('Цей фрагмент підтвердив')
        expect(mainButton('Підтвердити')).toBeUndefined()

        await click(mainButton('Наступний фрагмент'))
        expect(sent).toContainEqual({ type: 'start-selection' })
      })

      it('closes the question on cancel and on Esc without confirming', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read(
          { user: olena, canVerify: true },
          { [verifyPath]: () => json(confirmed()) },
        )
        await openReading()

        await click(mainButton('Підтвердити'))
        await click(dialogButton('Скасувати'))
        expect(dialog()).toBeNull()

        await click(mainButton('Підтвердити'))
        await act(async () => {
          window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
        })
        expect(dialog()).toBeNull()
        expect(verifies(calls)).toEqual([])
      })

      it('remembers not to ask only once a confirmation is sent', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read(
          { user: olena, canVerify: true },
          { [verifyPath]: () => json(confirmed()) },
        )
        await openReading()

        await click(mainButton('Підтвердити'))
        await click(dialog()?.querySelector('input[type="checkbox"]'))
        await click(dialogButton('Скасувати'))
        expect(fakeStorage.local.items.has('confirmWithoutAsking')).toBe(false)

        await click(mainButton('Підтвердити'))
        expect(dialog()?.querySelector('input[type="checkbox"]')).toHaveProperty('checked', false)
        await click(dialog()?.querySelector('input[type="checkbox"]'))
        await click(dialogButton('Підтвердити'))
        expect(fakeStorage.local.items.get('confirmWithoutAsking')).toBe(true)

        remount()
        await openReading()
        await click(mainButton('Підтвердити'))

        expect(dialog()).toBeNull()
        expect(verifies(calls)).toHaveLength(2)
        expect(document.activeElement).toBe(mainButton('Наступний фрагмент'))
      })

      it('closes the question when the profile opens, so it does not come back by itself', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true })
        await openReading()

        await click(mainButton('Підтвердити'))
        await click(accountButton())
        expect(container.textContent).toContain('Підпис підтверджень')
        await click(accountButton())

        expect(container.textContent).toContain('Села Борщаговки')
        expect(dialog()).toBeNull()
        expect(mainButton('Підтвердити')).toBeDefined()
      })

      it('offers no confirmation for a fragment without a shelfmark', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true }, {}, { ...two, shelfmark: undefined })
        await openReading()

        expect(container.textContent).toContain('Села Борщаговки')
        expect(mainButton('Підтвердити')).toBeUndefined()
      })

      it('gives the focus back to the button after the question closes', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true })
        await openReading()

        await click(mainButton('Підтвердити'))
        expect(document.activeElement?.textContent).toBe('Підтвердити')
        expect(dialog()?.contains(document.activeElement)).toBe(true)
        await click(dialogButton('Скасувати'))

        expect(document.activeElement).toBe(mainButton('Підтвердити'))
      })

      it('drops the question for good once a line is opened', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true })
        await openReading()

        await click(mainButton('Підтвердити'))
        const line = [...container.querySelectorAll('main li button')].find((button) =>
          button.textContent?.includes('Села Борщаговки'),
        )
        await click(line)
        expect(dialog()).toBeNull()
        await act(async () => {
          container
            .querySelector('textarea')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        await settle()

        expect(container.querySelector('textarea')).toBeNull()
        expect(dialog()).toBeNull()
        expect(mainButton('Підтвердити')).toBeDefined()
      })

      it('closes the question when the next fragment is selected', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true })
        await openReading()

        await click(mainButton('Підтвердити'))
        await click(mainButton('Виділити фрагмент'))

        expect(sent).toContainEqual({ type: 'start-selection' })
        expect(dialog()).toBeNull()
      })

      it('does not retry a failed confirmation once a line is opened', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read(
          { user: olena, canVerify: true },
          { [verifyPath]: failing(429, 'too_many_requests', 'Забагато запитів') },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))
        expect(statusBar()?.textContent).toContain('Забагато запитів')

        const line = [...container.querySelectorAll('main li button')].find((button) =>
          button.textContent?.includes('Села Борщаговки'),
        )
        await click(line)

        expect(statusBar()).toBeNull()
        expect(mainButton('Підтвердити')).toBeUndefined()
        expect(verifies(calls)).toHaveLength(1)
      })

      it('drops the answer for a fragment that is no longer shown and frees the button', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        let answer: (response: Response) => void = () => undefined
        const other: Transcription = {
          ...two,
          id: '9d3f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
          regionId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
          lines: [{ ...two.lines[0]!, text: 'Иванъ Петровъ' }],
        }
        let shown = two
        const calls = read(
          { user: olena, canVerify: true },
          {
            '/v1/recognitions': () =>
              json({ recognitionId, status: 'cached', transcriptionId: shown.id }, 201),
            [`/v1/recognitions/${recognitionId}`]: () =>
              json({ recognitionId, status: 'done', transcription: shown }),
            [verifyPath]: () =>
              new Promise<Response>((resolve) => {
                answer = resolve
              }),
          },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))
        expect(container.querySelectorAll('main li button')).toHaveLength(0)

        shown = other
        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await settle()
        expect(container.textContent).toContain('Иванъ Петровъ')
        expect(mainButton('Підтвердити')).not.toHaveProperty('disabled', true)
        await click(mainButton('Підтвердити'))
        expect(dialog()?.textContent).toContain('Підтвердити 1 рядок як прочитаний вами?')

        await act(async () => {
          answer(json(confirmed()))
          await new Promise((resolve) => setTimeout(resolve, 0))
        })
        await settle()

        expect(container.textContent).toContain('Иванъ Петровъ')
        expect(badge()?.textContent).toBe('чернетка моделі')
        expect(verifies(calls)).toHaveLength(1)
        expect(dialog()?.textContent).toContain('Підтвердити 1 рядок як прочитаний вами?')
      })

      it('checks the session again after a refusal, so the button goes away', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        let verifier = true
        const calls = read(
          { user: olena, canVerify: true },
          {
            '/api/auth/get-session': () =>
              json({ session: { id: 's' }, user: olena, canVerify: verifier }),
            [verifyPath]: () => {
              verifier = false
              return json({ error: { code: 'forbidden', message: 'Лише історик' } }, 403)
            },
          },
        )
        await openReading()
        const sessionChecks = calls.filter((call) => call.path === '/api/auth/get-session').length
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))
        await settle()

        expect(calls.filter((call) => call.path === '/api/auth/get-session')).toHaveLength(
          sessionChecks + 1,
        )
        expect(statusBar()?.textContent).toContain('Лише історик')
        expect(mainButton('Підтвердити')).toBeUndefined()
      })

      it('says the text goes out without a signature when the account has no name', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const calls = read({ user, canVerify: true }, { [verifyPath]: () => json(confirmed()) })
        await openReading()

        await click(mainButton('Підтвердити'))
        expect(dialog()?.textContent).toContain(
          'Текст стане публічним під CC BY 4.0 без підпису. Підпис можна додати в профілі.',
        )
        await click(dialogButton('Підтвердити'))

        expect(verifies(calls)[0]?.body).toEqual({})
      })

      it('shows who confirmed a version earlier, with the signature next to the account name', async () => {
        read(
          null,
          {},
          { ...confirmed('2026-11-14T10:00:00.000Z'), verifiedSignature: 'О. Коваль, ЦДІАК' },
        )
        await openReading()

        expect(badge()?.textContent).toBe(
          'підтверджено · Олена К. («О. Коваль, ЦДІАК») · 14.11.2026',
        )
        expect(mainButton('Наступний фрагмент')?.className).toContain('btn-primary')
      })

      it('hides the confirmation while a line is open', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read({ user: olena, canVerify: true })
        await openReading()

        const line = [...container.querySelectorAll('main li button')].find((button) =>
          button.textContent?.includes('Села Борщаговки'),
        )
        await click(line)
        expect(container.querySelector('textarea')).not.toBeNull()
        expect(mainButton('Підтвердити')).toBeUndefined()

        await act(async () => {
          container
            .querySelector('textarea')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        })
        await settle()
        expect(container.querySelector('textarea')).toBeNull()
        expect(mainButton('Підтвердити')).toBeDefined()
      })

      it('tells a reader outside the verifier list what the server said', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read(
          { user: olena, canVerify: true },
          { [verifyPath]: failing(403, 'forbidden', 'Підтверджувати може лише історик') },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))

        expect(statusBar()?.textContent).toContain('Підтверджувати може лише історик')
        expect(statusBar()?.querySelector('button')?.textContent).toBe('Зрозуміло')
        await click(statusBar()?.querySelector('button'))
        expect(statusBar()).toBeNull()
        expect(badge()?.textContent).toBe('чернетка моделі')
      })

      it('offers a retry after too many requests and confirms on the retry', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        let answers = 0
        const calls = read(
          { user: olena, canVerify: true },
          {
            [verifyPath]: () =>
              (answers += 1) === 1
                ? json({ error: { code: 'too_many_requests', message: 'Забагато запитів' } }, 429)
                : json(confirmed()),
          },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))

        expect(statusBar()?.textContent).toContain('Забагато запитів')
        expect(statusBar()?.querySelector('button')?.textContent).toBe('Спробувати ще раз')
        await click(statusBar()?.querySelector('button'))

        expect(verifies(calls)).toHaveLength(2)
        expect(statusBar()).toBeNull()
        expect(badge()?.textContent).toBe('підтверджено · Олена К. · сьогодні')
      })

      it('shows the newer version when the text changed before the confirmation', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        const current: Transcription = {
          ...two,
          id: '7c2e8d2f-5b1c-4e4d-8b54-3d2f8c1a0b22',
          version: 2,
          lines: [{ ...two.lines[0]!, text: 'Села Борщаговки крестьянинъ' }, two.lines[1]!],
        }
        read(
          { user: olena, canVerify: true },
          {
            [verifyPath]: () =>
              json({ error: { code: 'version_conflict', message: 'Конфлікт' }, current }, 409),
          },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))

        expect(statusBar()?.textContent).toContain('Текст змінили, поки ви його читали')
        expect(mainButton('Підтвердити')).toBeUndefined()
        expect(container.querySelectorAll('main li button')).toHaveLength(0)
        await click(statusBar()?.querySelector('button'))

        expect(container.textContent).toContain('Села Борщаговки крестьянинъ')
        expect(statusBar()).toBeNull()
        expect(mainButton('Підтвердити')).toBeDefined()
      })

      it('leaves one sign-in bar when a line is opened after the session expired', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read(
          { user: olena, canVerify: true },
          { [verifyPath]: failing(401, 'unauthorized', 'Потрібен вхід') },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))
        await settle()
        expect(statusBar()?.textContent).toContain('Увійдіть знову, щоб підтвердити')

        const line = [...container.querySelectorAll('main li button')].find((button) =>
          button.textContent?.includes('Села Борщаговки'),
        )
        await click(line)

        expect(container.textContent).not.toContain('Увійдіть знову, щоб підтвердити')
      })

      it('asks to sign in again when the session expired on the way', async () => {
        await fakeStorage.session.set({ sessionToken: token })
        read(
          { user: olena, canVerify: true },
          { [verifyPath]: failing(401, 'unauthorized', 'Потрібен вхід') },
        )
        await openReading()
        await click(mainButton('Підтвердити'))
        await click(dialogButton('Підтвердити'))
        await settle()

        expect(statusBar()?.textContent).toContain('Увійдіть знову, щоб підтвердити')
        await click(statusBar()?.querySelector('button'))
        expect(container.textContent).toContain('Надішлемо код для входу')

        await click(accountButton())
        await act(async () => {
          await fakeStorage.session.set({ sessionToken: 'newer-token.signature' })
        })
        await settle()
        expect(statusBar()).toBeNull()
        expect(mainButton('Підтвердити')).toBeDefined()
      })
    })

    describe('already read (E1)', () => {
      const verifiedOne: Transcription = {
        ...transcription,
        shelfmark: shelfmark(4),
        status: 'verified',
        verifiedBy: { name: 'Олена К.' },
        verifiedSignature: 'Олена К.',
        verifiedAt: '2026-11-12T10:00:00.000Z',
        lines: [
          { ...transcription.lines[0]!, text: 'Села Борщаговки крестьянинъ' },
          { ...transcription.lines[0]!, idx: 1, text: 'Коваленко и законная' },
        ],
      }
      const draftOne: Transcription = {
        ...transcription,
        id: '9d3f0a1b-2c3d-4e5f-8a9b-0c1d2e3f4a5b',
        regionId: '1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e',
        lines: [{ ...transcription.lines[0]!, text: 'Иванъ Петровъ' }],
      }
      const summary = ({ id, regionId, box, version, status, createdAt }: Transcription) => ({
        id,
        regionId,
        box,
        version,
        status,
        createdAt,
      })
      const page = (transcriptions: Transcription[]) => ({
        page: {
          id: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
          shelfmark: shelfmark(4),
          transcriptions: transcriptions.map(summary),
        },
      })
      const routes = (lookup: () => Response) => ({
        '/v1/pages/lookup': lookup,
        [`/v1/transcriptions/${verifiedOne.id}`]: () => json(verifiedOne),
        [`/v1/transcriptions/${draftOne.id}`]: () => json(draftOne),
      })
      const openPage = async () => {
        currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
        await render()
        await settle()
      }
      const badge = () => container.querySelector('main section > span')
      const listed = () => [...container.querySelectorAll('main ul li button')]

      it('lists what was already read on the sheet with each status', async () => {
        const calls = api(routes(() => json(page([verifiedOne, draftOne]))))
        await openPage()

        expect(badge()?.textContent).toBe('прочитано · 2 фрагменти · підтверджено 1')
        expect(container.textContent).toContain('Уже прочитано на цьому аркуші')
        expect(listed().map((button) => button.textContent)).toEqual([
          'Села Борщаговки крестьянинъпідтверджено · Олена К. · 12.11.2026',
          'Иванъ Петровъчернетка моделі',
        ])
        expect(mainButton('Виділити фрагмент')).toBeDefined()
        expect(calls.find((call) => call.path === '/v1/pages/lookup')).toBeDefined()
      })

      it('counts what the page has even when a fragment fails to load', async () => {
        api({
          ...routes(() => json(page([verifiedOne, draftOne]))),
          [`/v1/transcriptions/${draftOne.id}`]: () =>
            json({ error: { code: 'too_many_requests', message: 'Забагато' } }, 429),
        })
        await openPage()

        expect(badge()?.textContent).toBe('прочитано · 2 фрагменти · підтверджено 1')
        expect(listed()).toHaveLength(1)
      })

      it('says the sheet is not read yet when the page has nothing', async () => {
        api(routes(() => json({})))
        await openPage()

        expect(badge()?.textContent).toBe('ще не прочитано')
        expect(listed()).toHaveLength(0)
      })

      it('shows no reading status when the lookup failed', async () => {
        api(routes(() => json({ error: { code: 'internal_error', message: 'Збій' } }, 500)))
        await openPage()

        expect(badge()).toBeNull()
        expect(container.textContent).toContain('Виділіть фрагмент скану')
      })

      it('opens a confirmed fragment with who confirmed it and offers a correction', async () => {
        api(routes(() => json(page([verifiedOne, draftOne]))))
        await openPage()

        await click(listed()[0])

        const status = container.querySelector('[role="status"]')
        expect(status?.textContent).toContain('Цей фрагмент підтвердив(ла) Олена К. 12.11.2026')
        expect(badge()?.textContent).toBe('підтверджено · Олена К. · 12.11.2026')
        expect(container.textContent).toContain('Коваленко и законная')

        await click(status?.querySelector('button'))

        expect(container.querySelector('textarea')?.value).toBe('Села Борщаговки крестьянинъ')
      })

      it('asks again when the panel comes back to the sheet', async () => {
        let lookups = 0
        api({
          ...routes(() => ((lookups += 1) === 1 ? json({}) : json(page([draftOne])))),
          '/v1/recognitions': () => new Promise<Response>(() => undefined),
        })
        await openPage()
        expect(badge()?.textContent).toBe('ще не прочитано')

        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await click(mainButton('Скасувати'))
        await settle()

        expect(lookups).toBe(2)
        expect(badge()?.textContent).toBe('прочитано · 1 фрагмент')
        expect(listed()).toHaveLength(1)
      })

      it('drops the old list when asking again fails', async () => {
        let lookups = 0
        api({
          ...routes(() =>
            (lookups += 1) === 1
              ? json(page([draftOne]))
              : json({ error: { code: 'internal_error', message: 'Збій' } }, 500),
          ),
          '/v1/recognitions': () => new Promise<Response>(() => undefined),
        })
        await openPage()
        expect(listed()).toHaveLength(1)

        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await click(mainButton('Скасувати'))
        await settle()

        expect(lookups).toBe(2)
        expect(badge()).toBeNull()
        expect(listed()).toHaveLength(0)
      })

      it('shows the confirmed bar for a fragment that comes from the cache', async () => {
        api({
          ...routes(() => json({})),
          '/v1/recognitions': () =>
            json({ recognitionId, status: 'cached', transcriptionId: verifiedOne.id }, 201),
          [`/v1/recognitions/${recognitionId}`]: () =>
            json({ recognitionId, status: 'done', transcription: verifiedOne }),
        })
        await openPage()
        await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
        await settle()

        expect(container.querySelector('[role="status"]')?.textContent).toContain(
          'Цей фрагмент підтвердив(ла) Олена К. 12.11.2026',
        )
      })

      it('keeps one bar at a time when a guest edits a confirmed fragment', async () => {
        api(routes(() => json(page([verifiedOne]))))
        await openPage()
        await click(listed()[0])
        await click(container.querySelector('[role="status"] button'))
        const field = container.querySelector('textarea')
        if (!field) throw new Error('no line is open')
        await act(async () => {
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
            field,
            'Села Борщаговки крестьянинъ Іоаннъ',
          )
          field.dispatchEvent(new Event('input', { bubbles: true }))
        })
        await act(async () => {
          field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
        await act(async () => {
          container
            .querySelector('textarea')
            ?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
        })
        await settle()
        await click(accountButton())

        const bars = [...container.querySelectorAll('[role="status"]')].map(
          (bar) => bar.textContent,
        )
        expect(bars).toHaveLength(1)
        expect(bars[0]).toContain('Правки не збережено')
      })

      it('opens a draft fragment without the confirmed bar', async () => {
        api(routes(() => json(page([verifiedOne, draftOne]))))
        await openPage()

        await click(listed()[1])

        expect(container.querySelector('[role="status"]')).toBeNull()
        expect(badge()?.textContent).toBe('чернетка моделі')
        expect(container.textContent).toContain('Иванъ Петровъ')
      })
    })
  })
})

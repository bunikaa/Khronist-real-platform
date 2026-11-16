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
    expect(container.querySelector('main button')).toBeNull()
  })

  it('offers no selection on a portal page without a scan', async () => {
    currentPage = { type: 'page', shelfmark: null, scan: false, selecting: false }
    await render()
    expect(container.textContent).toContain('Відкрийте скан на підтримуваному порталі')
    expect(container.querySelector('main button')).toBeNull()
  })

  it('offers to select a fragment when the shelfmark is not recognized', async () => {
    currentPage = { type: 'page', shelfmark: null, scan: true, selecting: false }
    await render()
    expect(container.textContent).toContain('Виділити фрагмент')
    expect(container.textContent).toContain('Натисніть кнопку нижче, потім обведіть')
  })

  it('keeps the shelfmark of the fragment over its lines when another image opens', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json({ recognitionId, status: 'cached', transcriptionId: transcription.id }, 201),
        )
        .mockResolvedValueOnce(json({ recognitionId, status: 'done', transcription })),
    )
    await render()
    await deliver({ type: 'fragment', fragment, shelfmark: shelfmark(4) })
    await deliver({ type: 'page', shelfmark: shelfmark(5), scan: true, selecting: false })

    expect(container.textContent).toContain('Села Борщаговки')
    expect(container.querySelector('header')?.textContent).toContain('зобр. 4')
    expect(container.querySelector('header')?.textContent).not.toContain('зобр. 5')
  })

  it('shows the warnings of the model next to the lines', async () => {
    currentPage = { type: 'page', shelfmark: shelfmark(4), scan: true, selecting: false }
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
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
        '/api/auth/get-session': () => json({ session: { id: 's' }, user }),
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
        '/api/auth/get-session': () => json({ session: { id: 's' }, user: { ...user, name } }),
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
        '/api/auth/get-session': () => json({ session: { id: 's' }, user }),
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
      const calls = api({ '/api/auth/get-session': () => json({ session: { id: 's' }, user }) })
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
        '/api/auth/get-session': () => json({ session: { id: 's' }, user }),
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
        '/api/auth/get-session': () => json({ session: { id: 's' }, user }),
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
      api({ '/api/auth/get-session': () => json({ session: { id: 's' }, user }) })
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
  })
})

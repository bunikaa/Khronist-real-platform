import type { Shelfmark, Transcription } from '@khronist/contracts'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Fragment, PageMessage } from '../messages.ts'

type Listener = (message: unknown, sender: { tab?: { id?: number } }) => void

const listeners = new Set<Listener>()
const sent: unknown[] = []
let currentPage: PageMessage | undefined

vi.mock('wxt/browser', () => ({
  browser: {
    tabs: {
      query: async () => [{ id: 1 }],
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
      getAll: async () => [{ name: 'open-panel', shortcut: '' }],
      onCommand: { addListener: () => {}, removeListener: () => {} },
    },
  },
}))

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

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

const deliver = async (message: unknown) => {
  await act(async () => {
    for (const listener of listeners) listener(message, { tab: { id: 1 } })
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('side panel', () => {
  let root: Root
  let container: HTMLElement

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    listeners.clear()
    sent.length = 0
    currentPage = undefined
    vi.unstubAllGlobals()
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
    expect(container.querySelector('button')).toBeNull()
  })

  it('offers no selection on a portal page without a scan', async () => {
    currentPage = { type: 'page', shelfmark: null, scan: false, selecting: false }
    await render()
    expect(container.textContent).toContain('Відкрийте скан на підтримуваному порталі')
    expect(container.querySelector('button')).toBeNull()
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
})

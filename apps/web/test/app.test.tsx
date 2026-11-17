import { strings } from '@khronist/ui'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../src/App.tsx'
import { json, searchItem, searchPage } from './fixtures.ts'

const highlighted = vi.hoisted(() => ({ count: 0 }))

vi.mock('../src/search/highlight.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/search/highlight.ts')>()
  return {
    highlightSnippet: (...args: Parameters<typeof original.highlightSnippet>) => {
      highlighted.count += 1
      return original.highlightSnippet(...args)
    },
  }
})

const text = strings.web

let container: HTMLDivElement
let root: Root
const requested: URL[] = []
let replies: Array<Response | Promise<Response>> = []

const reply = (...responses: Array<Response | Promise<Response>>) => {
  replies.push(...responses)
}

const deferred = () => {
  let resolve: (response: Response) => void = () => {}
  const promise = new Promise<Response>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

const render = async () => {
  await act(async () => {
    root.render(<App />)
  })
}

const field = (label: string) => {
  const found = [...container.querySelectorAll('label')].find((l) => l.textContent === label)
  const input = found?.htmlFor
    ? container.querySelector(`[id="${found.htmlFor}"]`)
    : found?.querySelector('input')
  if (!(input instanceof HTMLInputElement)) throw new Error(`no field ${label}`)
  return input
}

const type = async (label: string, value: string) => {
  const input = field(label)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const findButton = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)

const button = (label: string) => {
  const found = findButton(label)
  if (!found) throw new Error(`no button ${label}`)
  return found
}

const click = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

const settle = async (resolve: () => void) => {
  await act(async () => {
    resolve()
  })
}

const searchFor = async (query: string) => {
  await type(text.query, query)
  await click(button(text.search))
}

const announced = () => container.querySelector('p.sr-only[role="status"]')?.textContent ?? null
const bar = () => container.querySelector('[role="status"]:not(.sr-only)')?.textContent ?? null
const lastRequest = () => requested.at(-1)?.searchParams
const requestOf = (index: number) => Object.fromEntries(requested[index]?.searchParams ?? [])
const items = () => container.querySelectorAll('li')
const results = () => container.querySelector(`section[aria-label="${text.results}"]`)

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  window.history.replaceState(null, '', '/')
  requested.length = 0
  replies = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => {
      requested.push(new URL(input))
      const next = replies.shift()
      if (!next) throw new TypeError('Failed to fetch')
      return next
    }),
  )
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

describe('W5 search', () => {
  it('starts with the form and no results, asking nothing', async () => {
    await render()
    expect(container.querySelector('h1')?.textContent).toBe(text.title)
    expect(field(text.verifiedOnly).checked).toBe(true)
    expect(container.querySelector('ul')).toBeNull()
    expect(announced()).toBe('')
    expect(requested).toHaveLength(0)
  })

  it('searches only verified transcriptions by default and shows each result', async () => {
    reply(json(200, { items: [searchItem(8, { status: 'verified' })] }))
    await render()
    await searchFor('  Коваленко ')
    expect(`${requested[0]?.origin}${requested[0]?.pathname}`).toBe(
      'https://api.khronist.org/v1/search',
    )
    expect(requestOf(0)).toEqual({ q: 'Коваленко', verifiedOnly: 'true' })
    const item = items()[0]
    expect(item?.textContent).toContain(
      'ЦДІАК України · ф. 127, оп. 1078, спр. 2276 · зобр. 8 · 1905',
    )
    expect(item?.textContent).toContain(strings.confirm.verified)
    expect([...(item?.querySelectorAll('mark') ?? [])].map((m) => m.textContent)).toEqual([
      'Коваленко',
      'Коваленко',
    ])
    const link = item?.querySelector('a')
    expect(link?.textContent).toBe(text.openPortal)
    expect(link?.href).toBe(searchItem(8).portalUrl)
    expect(link?.target).toBe('_blank')
    expect(link?.rel).toBe('noopener noreferrer')
    expect(window.location.search).toBe(`?q=${encodeURIComponent('Коваленко')}&verifiedOnly=true`)
    expect(announced()).toBe('Знайдено 1 транскрипцію')
  })

  it('shows no portal link and no empty snippet when the result has neither', async () => {
    reply(json(200, { items: [searchItem(8, { portalUrl: undefined, snippet: '' })] }))
    await render()
    await searchFor('Коваленко')
    expect(container.querySelector('li a')).toBeNull()
    expect(items()[0]?.querySelectorAll('p')).toHaveLength(1)
  })

  it('sends the filters the reader filled', async () => {
    reply(json(200, { items: [] }))
    await render()
    await type(text.archive, 'ЦДІАК України')
    await type(text.fond, '127')
    await type(text.yearFrom, '1900')
    await type(text.yearTo, '1910')
    await searchFor('Борщагівка')
    expect(requestOf(0)).toEqual({
      q: 'Борщагівка',
      archive: 'ЦДІАК України',
      fond: '127',
      yearFrom: '1900',
      yearTo: '1910',
      verifiedOnly: 'true',
    })
  })

  it('moves focus to the first field that failed the check', async () => {
    await render()
    await searchFor('Ми')
    expect(document.activeElement).toBe(field(text.query))
    await type(text.yearFrom, '1910')
    await type(text.yearTo, '1900')
    await searchFor('Коваленко')
    expect(document.activeElement).toBe(field(text.yearFrom))
    await type(text.yearFrom, '')
    await type(text.yearTo, '2101')
    await click(button(text.search))
    expect(document.activeElement).toBe(field(text.yearTo))
    expect(field(text.yearTo).getAttribute('aria-describedby')).toBeTruthy()
    expect(requested).toHaveLength(0)
  })

  it('marks a wrong query or years without asking the server', async () => {
    await render()
    await searchFor('   ')
    expect(field(text.query).getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain(text.queryInvalid)
    await type(text.yearFrom, '1910')
    await type(text.yearTo, '1900')
    await searchFor('Коваленко')
    expect(field(text.query).getAttribute('aria-invalid')).toBe('false')
    expect(field(text.yearFrom).getAttribute('aria-invalid')).toBe('true')
    expect(container.textContent).toContain(text.yearsInvalid)
    expect(requested).toHaveLength(0)
  })

  it.each(['Ми', '1905', 'від або для'])(
    'does not send «%s», which has no word the server searches for',
    async (query) => {
      await render()
      await searchFor(query)
      expect(field(text.query).getAttribute('aria-invalid')).toBe('true')
      expect(container.textContent).toContain(text.queryNoWords)
      expect(container.textContent).not.toContain(text.includeDrafts)
      expect(requested).toHaveLength(0)
    },
  )
})

describe('W5 pages', () => {
  it('loads the next page with the cursor, skips repeated results and focuses the first new one', async () => {
    reply(json(200, searchPage), json(200, { items: [searchItem(19), searchItem(30)] }))
    await render()
    await searchFor('Коваленко')
    expect(items()).toHaveLength(2)
    expect(announced()).toBe('Показано 2 транскрипції, є ще')
    await click(button(text.more))
    expect(lastRequest()?.get('cursor')).toBe(searchPage.nextCursor)
    expect(lastRequest()?.get('q')).toBe('Коваленко')
    expect(items()).toHaveLength(3)
    expect(document.activeElement).toBe(items()[2])
    expect(findButton(text.more)).toBeUndefined()
    expect(announced()).toBe('Знайдено 3 транскрипції')
  })

  it('keeps «Показати ще» focusable and ignores clicks while the page loads', async () => {
    const next = deferred()
    reply(json(200, searchPage), next.promise)
    await render()
    await searchFor('Коваленко')
    await click(button(text.more))
    const loading = button(text.loadingMore)
    expect(loading.getAttribute('aria-disabled')).toBe('true')
    expect(loading.disabled).toBe(false)
    await click(loading)
    expect(requested).toHaveLength(2)
    expect(announced()).toBe(text.loadingMore)
    await settle(() => next.resolve(json(200, { items: [searchItem(30)], nextCursor: 'next' })))
    expect(items()).toHaveLength(3)
  })

  it('leaves focus where the reader moved it while the next page loaded', async () => {
    const next = deferred()
    reply(json(200, searchPage), next.promise)
    await render()
    await searchFor('Коваленко')
    const more = button(text.more)
    more.focus()
    await click(more)
    field(text.query).focus()
    await settle(() => next.resolve(json(200, { items: [searchItem(30)] })))
    expect(items()).toHaveLength(3)
    expect(document.activeElement).toBe(field(text.query))
  })

  it('highlights only the new snippets when the next page arrives', async () => {
    reply(json(200, searchPage), json(200, { items: [searchItem(30)] }))
    await render()
    await searchFor('Коваленко')
    highlighted.count = 0
    await click(button(text.more))
    expect(items()).toHaveLength(3)
    expect(highlighted.count).toBe(1)
  })

  it('keeps the results and offers a retry when the next page fails', async () => {
    const retried = deferred()
    reply(json(200, searchPage), json(503, { error: { code: 'shutting_down', message: '' } }))
    await render()
    await searchFor('Коваленко')
    const more = button(text.more)
    more.focus()
    await click(more)
    expect(items()).toHaveLength(2)
    expect(bar()).toBe(text.unavailable + text.retry)
    expect(findButton(text.more)).toBeUndefined()
    expect(document.activeElement).toBe(results())
    expect(announced()).toBe('')
    reply(retried.promise)
    const retry = button(text.retry)
    retry.focus()
    await click(retry)
    expect(lastRequest()?.get('cursor')).toBe(searchPage.nextCursor)
    expect(document.activeElement).toBe(button(text.loadingMore))
    await settle(() => retried.resolve(json(200, { items: [searchItem(30)] })))
    expect(items()).toHaveLength(3)
    expect(document.activeElement).toBe(items()[2])
  })

  it('starts the search again from the first page when the server rejects the cursor', async () => {
    reply(json(200, searchPage), json(400, { error: { code: 'bad_request', message: '' } }))
    await render()
    await searchFor('Коваленко')
    const more = button(text.more)
    more.focus()
    await click(more)
    expect(bar()).toBe(text.rejected + text.restart)
    expect(findButton(text.more)).toBeUndefined()
    expect(document.activeElement).toBe(results())
    reply(json(200, { items: [searchItem(40)] }))
    await click(button(text.restart))
    expect(requestOf(2)).toEqual({ q: 'Коваленко', verifiedOnly: 'true' })
    expect(items()).toHaveLength(1)
  })
})

describe('W5 verified switch', () => {
  it('searches the last search again, not unsaved edits, and shows it in the form', async () => {
    reply(json(200, { items: [searchItem(8, { status: 'verified' })] }), json(200, searchPage))
    await render()
    await searchFor('Коваленко')
    await type(text.query, 'Шевченко')
    await type(text.fond, '999')
    await click(field(text.verifiedOnly))
    expect(requestOf(1)).toEqual({ q: 'Коваленко', verifiedOnly: 'false' })
    expect(field(text.verifiedOnly).checked).toBe(false)
    expect(field(text.query).value).toBe('Коваленко')
    expect(field(text.fond).value).toBe('')
    expect(window.location.search).toBe(`?q=${encodeURIComponent('Коваленко')}&verifiedOnly=false`)
    expect(items()).toHaveLength(2)
  })

  it('keeps the switch and the address on the search that ran when the form is invalid', async () => {
    reply(json(200, searchPage), json(200, { items: [] }))
    await render()
    await searchFor('Коваленко')
    await searchFor('Ми')
    expect(requested).toHaveLength(1)
    expect(field(text.verifiedOnly).checked).toBe(true)
    expect(window.location.search).toBe(`?q=${encodeURIComponent('Коваленко')}&verifiedOnly=true`)
    await click(field(text.verifiedOnly))
    expect(requestOf(1)).toEqual({ q: 'Коваленко', verifiedOnly: 'false' })
    expect(field(text.verifiedOnly).checked).toBe(false)
    expect(field(text.query).value).toBe('Коваленко')
    expect(field(text.query).getAttribute('aria-invalid')).toBe('false')
    expect(container.textContent).not.toContain(text.queryNoWords)
  })

  it('only changes the form when nothing was searched yet', async () => {
    reply(json(200, { items: [] }))
    await render()
    await click(field(text.verifiedOnly))
    expect(requested).toHaveLength(0)
    expect(field(text.verifiedOnly).checked).toBe(false)
    await searchFor('Коваленко')
    expect(requestOf(0)).toEqual({ q: 'Коваленко', verifiedOnly: 'false' })
  })

  it('offers to search drafts of the last search when nothing verified matches', async () => {
    reply(json(200, { items: [] }), json(200, { items: [searchItem(8)] }))
    await render()
    await searchFor('Коваленко')
    expect(container.textContent).toContain(text.nothingVerified)
    expect(announced()).toBe(text.nothing)
    await type(text.query, 'Шевченко')
    const drafts = button(text.includeDrafts)
    drafts.focus()
    await click(drafts)
    expect(requestOf(1)).toEqual({ q: 'Коваленко', verifiedOnly: 'false' })
    expect(field(text.verifiedOnly).checked).toBe(false)
    expect(field(text.query).value).toBe('Коваленко')
    expect(items()[0]?.textContent).toContain(strings.confirm.draft)
    expect(document.activeElement).toBe(results())
  })

  it.each([
    ['', text.nothingHint],
    ['&fond=127', text.nothingFiltered],
  ])('suggests what to change when drafts do not match either (%s)', async (filters, hint) => {
    reply(json(200, { items: [] }))
    window.history.replaceState(null, '', `/?q=Ковальчук${filters}&verifiedOnly=false`)
    await render()
    expect(lastRequest()?.get('q')).toBe('Ковальчук')
    expect(field(text.query).value).toBe('Ковальчук')
    expect(container.textContent).toContain(hint)
    expect(findButton(text.includeDrafts)).toBeUndefined()
  })

  it.each(['0', 'no', 'off', 'n', 'disabled', 'FALSE'])(
    'reads verifiedOnly=%s in the address as off, as the API does',
    async (value) => {
      reply(json(200, { items: [] }))
      window.history.replaceState(null, '', `/?q=Ковальчук&verifiedOnly=${value}`)
      await render()
      expect(lastRequest()?.get('verifiedOnly')).toBe('false')
      expect(field(text.verifiedOnly).checked).toBe(false)
      expect(window.location.search).toContain('verifiedOnly=false')
    },
  )

  it.each(['', 'yes', '1', 'maybe'])(
    'reads verifiedOnly=%s in the address as on',
    async (value) => {
      reply(json(200, { items: [] }))
      window.history.replaceState(null, '', `/?q=Ковальчук&verifiedOnly=${value}`)
      await render()
      expect(lastRequest()?.get('verifiedOnly')).toBe('true')
    },
  )
})

describe('W5 requests in flight', () => {
  it('starts a corrected search at once, dropping the one still loading', async () => {
    const first = deferred()
    reply(first.promise, json(200, { items: [searchItem(50)] }))
    await render()
    await searchFor('Ковален')
    expect(announced()).toBe(text.searching)
    await searchFor('Коваленко')
    expect(requested).toHaveLength(2)
    expect(requestOf(1)).toEqual({ q: 'Коваленко', verifiedOnly: 'true' })
    expect(items()).toHaveLength(1)
    await settle(() => first.resolve(json(200, searchPage)))
    expect(items()).toHaveLength(1)
    expect(items()[0]?.textContent).toContain('зобр. 50')
    expect(window.location.search).toContain(encodeURIComponent('Коваленко'))
  })

  it('drops a search answered after the switch started a newer one', async () => {
    const first = deferred()
    reply(first.promise, json(200, { items: [searchItem(30)] }))
    await render()
    await searchFor('Коваленко')
    await click(field(text.verifiedOnly))
    expect(items()).toHaveLength(1)
    await settle(() => first.resolve(json(200, searchPage)))
    expect(items()).toHaveLength(1)
    expect(items()[0]?.textContent).toContain('зобр. 30')
  })

  it('drops a next page answered after a new search started', async () => {
    const next = deferred()
    reply(json(200, searchPage), next.promise, json(200, { items: [searchItem(50)] }))
    await render()
    await searchFor('Коваленко')
    await click(button(text.more))
    await searchFor('Шевченко')
    expect(items()).toHaveLength(1)
    await settle(() => next.resolve(json(200, { items: [searchItem(30)] })))
    expect(items()).toHaveLength(1)
    expect(items()[0]?.textContent).toContain('зобр. 50')
  })
})

describe('W5 focus fallback', () => {
  it('does not pull focus to the results after the reader left them for nothing', async () => {
    reply(json(200, { items: [] }), json(200, searchPage))
    await render()
    await searchFor('Коваленко')
    const drafts = button(text.includeDrafts)
    drafts.focus()
    drafts.blur()
    await searchFor('Шевченко')
    expect(items()).toHaveLength(2)
    expect(document.activeElement).toBe(document.body)
  })
})

describe('W5 failures', () => {
  it.each([
    [
      json(429, { error: { code: 'too_many_requests', message: '' } }, { 'retry-after': '17' }),
      'Забагато пошуків поспіль. Спробуйте за 17 с',
    ],
    [
      json(429, { error: { code: 'too_many_requests', message: '' } }),
      'Забагато пошуків поспіль. Спробуйте за хвилину',
    ],
    [json(500, { error: { code: 'internal_error', message: '' } }), text.unavailable],
    [json(200, { items: [{ snippet: 'без шифру' }] }), strings.read.badResponse],
  ])('shows a failed search with a retry (%#)', async (response, message) => {
    reply(response)
    await render()
    await searchFor('Коваленко')
    expect(bar()).toBe(message + text.retry)
    expect(announced()).toBe('')
    reply(json(200, searchPage))
    const retry = button(text.retry)
    retry.focus()
    await click(retry)
    expect(requestOf(1)).toEqual(requestOf(0))
    expect(items()).toHaveLength(2)
    expect(document.activeElement).toBe(results())
  })

  it('sends the reader to the query when the server rejects the first page', async () => {
    reply(json(400, { error: { code: 'bad_request', message: '' } }))
    await render()
    await searchFor('Коваленко')
    expect(bar()).toBe(text.rejected + text.editQuery)
    await click(button(text.editQuery))
    expect(document.activeElement).toBe(field(text.query))
    expect(requested).toHaveLength(1)
  })

  it('says the server is unreachable when the request fails', async () => {
    await render()
    await searchFor('Коваленко')
    expect(bar()).toBe(strings.read.offline + text.retry)
  })

  it('shows the retried search in the form, not an invalid edit made meanwhile', async () => {
    reply(json(500, { error: { code: 'internal_error', message: '' } }))
    await render()
    await searchFor('Коваленко')
    await searchFor('Ми')
    expect(field(text.query).getAttribute('aria-invalid')).toBe('true')
    reply(json(200, searchPage))
    await click(button(text.retry))
    expect(requestOf(1)).toEqual({ q: 'Коваленко', verifiedOnly: 'true' })
    expect(field(text.query).value).toBe('Коваленко')
    expect(field(text.query).getAttribute('aria-invalid')).toBe('false')
  })
})

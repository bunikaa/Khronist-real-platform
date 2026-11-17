import { describe, expect, it } from 'vitest'
import {
  hasFilters,
  parseSearchForm,
  searchFormOf,
  withVerifiedOnly,
  type SearchForm,
} from '../src/search/query.ts'

const form = (changes: Partial<SearchForm> = {}): SearchForm => ({
  q: 'Коваленко',
  archive: '',
  fond: '',
  yearFrom: '',
  yearTo: '',
  verifiedOnly: true,
  ...changes,
})

const paramsOf = (changes: Partial<SearchForm>) => {
  const parsed = parseSearchForm(form(changes))
  return 'params' in parsed ? [...parsed.params] : parsed
}

describe('parseSearchForm', () => {
  it.each([
    [
      {},
      [
        ['q', 'Коваленко'],
        ['verifiedOnly', 'true'],
      ],
    ],
    [
      { q: '  Борщагівка ' },
      [
        ['q', 'Борщагівка'],
        ['verifiedOnly', 'true'],
      ],
    ],
    [
      { verifiedOnly: false },
      [
        ['q', 'Коваленко'],
        ['verifiedOnly', 'false'],
      ],
    ],
    [
      { archive: ' ЦДІАК України ', fond: ' 127 ', yearFrom: '1850', yearTo: ' 1905 ' },
      [
        ['q', 'Коваленко'],
        ['archive', 'ЦДІАК України'],
        ['fond', '127'],
        ['yearFrom', '1850'],
        ['yearTo', '1905'],
        ['verifiedOnly', 'true'],
      ],
    ],
    [
      { archive: '   ', fond: '', yearFrom: ' ' },
      [
        ['q', 'Коваленко'],
        ['verifiedOnly', 'true'],
      ],
    ],
    [
      { yearFrom: '1905', yearTo: '1905' },
      [
        ['q', 'Коваленко'],
        ['yearFrom', '1905'],
        ['yearTo', '1905'],
        ['verifiedOnly', 'true'],
      ],
    ],
  ])('builds the query parameters for %j', (changes, expected) => {
    expect(paramsOf(changes)).toEqual(expected)
  })

  it.each([
    [{ q: '' }, ['q']],
    [{ q: '   ' }, ['q']],
    [{ q: 'я'.repeat(201) }, ['q']],
    [{ yearFrom: '999' }, ['years']],
    [{ yearTo: '2101' }, ['years']],
    [{ yearFrom: '18a0' }, ['years']],
    [{ yearFrom: '1850.5' }, ['years']],
    [{ yearFrom: '1906', yearTo: '1905' }, ['years']],
    [{ q: '', yearTo: '0' }, ['q', 'years']],
    [{ q: 'Ми' }, ['words']],
    [{ q: '1905' }, ['words']],
    [{ q: 'від або для' }, ['words']],
    [{ q: 'XIX ст.' }, ['words']],
    [{ q: 'Ми', yearFrom: '1906', yearTo: '1905' }, ['words', 'years']],
    [{ q: 'Ми', yearFrom: '999' }, ['words', 'years']],
    [{ q: '', yearFrom: '1906', yearTo: '1905' }, ['q', 'years']],
    [{ q: 'я'.repeat(201), yearTo: '2101' }, ['q', 'years']],
  ])('rejects %j before asking the server', (changes, invalid) => {
    expect(paramsOf(changes)).toEqual({ invalid })
  })

  it('accepts a query of exactly 200 characters', () => {
    expect(parseSearchForm(form({ q: 'я'.repeat(200) }))).toHaveProperty('params')
  })

  it('accepts a query with one significant word among stop words and numbers', () => {
    expect(paramsOf({ q: 'від Коваленка 1905' })).toEqual([
      ['q', 'від Коваленка 1905'],
      ['verifiedOnly', 'true'],
    ])
  })
})

describe('searchFormOf', () => {
  it('turns «лише підтверджені» on unless the address turns it off', () => {
    expect(searchFormOf(new URLSearchParams(''))).toEqual(form({ q: '' }))
    expect(searchFormOf(new URLSearchParams('q=Коваленко&verifiedOnly=false')).verifiedOnly).toBe(
      false,
    )
  })

  it.each([
    ['', true],
    ['true', true],
    ['yes', true],
    ['abc', true],
    ['false', false],
    ['0', false],
    ['no', false],
    ['off', false],
    ['n', false],
    ['disabled', false],
    ['FALSE', false],
  ])('reads verifiedOnly=%s as the API does: %s', (value, verifiedOnly) => {
    expect(searchFormOf(new URLSearchParams({ q: 'x', verifiedOnly: value })).verifiedOnly).toBe(
      verifiedOnly,
    )
  })

  it('reads back the query string it built', () => {
    const filled = form({ archive: 'ЦДІАК України', fond: '127', yearFrom: '1850', yearTo: '1905' })
    const parsed = parseSearchForm(filled)
    expect('params' in parsed && searchFormOf(parsed.params)).toEqual(filled)
  })
})

describe('withVerifiedOnly', () => {
  it('flips only the verified switch of a search', () => {
    const params = new URLSearchParams('q=Коваленко&fond=127&verifiedOnly=true')
    expect(withVerifiedOnly(params, false).toString()).toBe(
      `q=${encodeURIComponent('Коваленко')}&fond=127&verifiedOnly=false`,
    )
    expect(params.get('verifiedOnly')).toBe('true')
  })
})

describe('hasFilters', () => {
  it.each([
    ['q=x&verifiedOnly=true', false],
    ['q=x&archive=A', true],
    ['q=x&fond=1', true],
    ['q=x&yearFrom=1900', true],
    ['q=x&yearTo=1900', true],
  ])('tells whether %s narrows the search', (query, expected) => {
    expect(hasFilters(new URLSearchParams(query))).toBe(expected)
  })
})

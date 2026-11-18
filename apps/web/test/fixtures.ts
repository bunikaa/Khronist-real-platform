import type { RecentResponse, SearchResponse } from '@khronist/contracts'
import type { SearchItem } from '../src/search/useSearch.ts'

const portalUrl = 'https://archium.cdiak.archives.gov.ua/file-viewer/134082#file-3246508'

export const searchItem = (index: number, changes: Partial<SearchItem> = {}): SearchItem => ({
  transcriptionId: `01a1e4e4-7535-7641-9d1b-${String(index).padStart(12, '0')}`,
  shelfmark: {
    archive: 'ЦДІАК України',
    fond: '127',
    opys: '1078',
    sprava: '2276',
    image: index,
    portal: 'archium',
    portalUrl,
  },
  yearFrom: 1905,
  yearTo: 1905,
  snippet: 'Деревни Михайловский Борщаговки крестьяне. Иван Феодотов Коваленко и Андрей Коваленко',
  status: 'draft',
  portalUrl,
  ...changes,
})

export const searchPage: SearchResponse = {
  items: [searchItem(8), searchItem(19, { status: 'verified' })],
  nextCursor: 'eyJyYW5rIjoxLjA2LCJpZCI6IjAxYTEifQ',
}

export const recentItem = (index: number): RecentResponse['items'][number] => ({
  ...searchItem(index),
  snippet: `Запис ${index}. Иван Феодотов Коваленко`,
  status: 'verified',
  verifiedAt: '2026-11-18T10:00:00.000Z',
})

export const recentPage: RecentResponse = {
  items: [recentItem(4), recentItem(5)],
  nextCursor: 'eyJhdCI6IjIwMjYifQ',
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })

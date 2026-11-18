import {
  recentResponseSchema,
  searchResponseSchema,
  type SearchResponse,
} from '@khronist/contracts'
import { apiOrigin } from './origin.ts'

export type SearchProblem =
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'rejected' }
  | { kind: 'unavailable' }
  | { kind: 'offline' }
  | { kind: 'bad_response' }

type PageOutcome = { ok: true; page: SearchResponse } | { ok: false; problem: SearchProblem }

export type PageLoader = (
  params: URLSearchParams,
  cursor: string | undefined,
  signal: AbortSignal,
) => Promise<PageOutcome>

export const searchUrl = (params: URLSearchParams, cursor?: string): string => {
  const query = new URLSearchParams(params)
  if (cursor !== undefined) query.set('cursor', cursor)
  return `${apiOrigin}/v1/search?${query}`
}

export const recentUrl = (cursor?: string): string => {
  const path = `${apiOrigin}/v1/transcriptions/recent`
  return cursor === undefined ? path : `${path}?${new URLSearchParams({ cursor })}`
}

const retryAfterOf = (headers: Headers): number | undefined => {
  const seconds = Number(headers.get('retry-after') ?? Number.NaN)
  return Number.isInteger(seconds) && seconds > 0 ? seconds : undefined
}

const problemOf = (response: Response): SearchProblem => {
  if (response.status === 429)
    return { kind: 'rate_limited', retryAfterSeconds: retryAfterOf(response.headers) }
  if (response.status === 400) return { kind: 'rejected' }
  if (response.status >= 500) return { kind: 'unavailable' }
  return { kind: 'bad_response' }
}

const fetchPage = async (
  url: string,
  parse: (body: unknown) => SearchResponse | undefined,
  signal: AbortSignal,
): Promise<PageOutcome> => {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch {
    return { ok: false, problem: { kind: 'offline' } }
  }
  if (!response.ok) return { ok: false, problem: problemOf(response) }
  const page = parse(await response.json().catch(() => null))
  return page ? { ok: true, page } : { ok: false, problem: { kind: 'bad_response' } }
}

export const loadSearchPage: PageLoader = (params, cursor, signal) =>
  fetchPage(searchUrl(params, cursor), (body) => searchResponseSchema.safeParse(body).data, signal)

export const loadRecentPage: PageLoader = (_params, cursor, signal) =>
  fetchPage(recentUrl(cursor), (body) => recentResponseSchema.safeParse(body).data, signal)

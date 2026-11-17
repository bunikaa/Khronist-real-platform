import { searchResponseSchema, type SearchResponse } from '@khronist/contracts'
import { apiOrigin } from './origin.ts'

export type SearchProblem =
  | { kind: 'rate_limited'; retryAfterSeconds: number | undefined }
  | { kind: 'rejected' }
  | { kind: 'unavailable' }
  | { kind: 'offline' }
  | { kind: 'bad_response' }

type SearchOutcome = { ok: true; page: SearchResponse } | { ok: false; problem: SearchProblem }

export const searchUrl = (params: URLSearchParams, cursor?: string): string => {
  const query = new URLSearchParams(params)
  if (cursor !== undefined) query.set('cursor', cursor)
  return `${apiOrigin}/v1/search?${query}`
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

export const fetchSearchPage = async (url: string, signal: AbortSignal): Promise<SearchOutcome> => {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch {
    return { ok: false, problem: { kind: 'offline' } }
  }
  if (!response.ok) return { ok: false, problem: problemOf(response) }
  const page = searchResponseSchema.safeParse(await response.json().catch(() => null))
  return page.success
    ? { ok: true, page: page.data }
    : { ok: false, problem: { kind: 'bad_response' } }
}

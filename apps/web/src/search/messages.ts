import { strings } from '@khronist/ui'
import type { SearchProblem } from '../api/search.ts'
import type { SearchState } from './useSearch.ts'

const text = strings.web

export const problemMessage = (problem: SearchProblem): string => {
  switch (problem.kind) {
    case 'rate_limited':
      return text.rateLimited(problem.retryAfterSeconds)
    case 'rejected':
      return text.rejected
    case 'unavailable':
      return text.unavailable
    case 'offline':
      return strings.read.offline
    case 'bad_response':
      return strings.read.badResponse
  }
}

export const announcementOf = (state: SearchState): string => {
  switch (state.phase) {
    case 'idle':
      return ''
    case 'searching':
      return text.searching
    case 'failed':
      return ''
    case 'found':
      if (state.items.length === 0) return text.nothing
      if (state.more.phase === 'failed') return ''
      if (state.more.phase === 'loading') return text.loadingMore
      return text.found(state.items.length, state.nextCursor !== undefined)
  }
}

import { StatusBar, strings } from '@khronist/ui'
import type { SearchProblem } from '../api/search.ts'
import { problemMessage } from './messages.ts'

type ProblemBarProps = {
  problem: SearchProblem
  onRetry: () => void
  whenRejected: { action: string; onAction: () => void }
}

export const ProblemBar = ({ problem, onRetry, whenRejected }: ProblemBarProps) => {
  const rejected = problem.kind === 'rejected'
  return (
    <StatusBar
      type={problem.kind === 'rate_limited' ? 'warning' : 'error'}
      message={problemMessage(problem)}
      action={rejected ? whenRejected.action : strings.web.retry}
      onAction={rejected ? whenRejected.onAction : onRetry}
    />
  )
}

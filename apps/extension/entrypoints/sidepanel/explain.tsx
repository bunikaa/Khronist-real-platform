import type { Citation, ExplainResponse } from '@khronist/contracts'
import { ExplainSheet, FactPair, SourceRef, StatusBar, strings } from '@khronist/ui'
import { CircleAlert } from 'lucide-react'
import { failureAlertOf, type RequestFailure } from './failures.ts'
import type { Explaining } from './useExplain.ts'

export const distinctSources = (citations: Citation[]) => {
  const seen = new Set<string>()
  return citations.filter(({ sourceId }) => {
    if (seen.has(sourceId)) return false
    seen.add(sourceId)
    return true
  })
}

const AnswerText = ({ answer, reason, confidence }: ExplainResponse) => {
  if (answer === null) {
    const unknown = reason ? strings.explain.noSources : strings.explain.unavailable
    return <p className="text-body-14 text-ink-muted">{unknown}</p>
  }
  return (
    <>
      <p className="text-body-14">{answer}</p>
      {confidence === 'low' && (
        <p className="flex gap-2 text-body-12 text-ink-muted">
          <CircleAlert size={16} className="shrink-0 text-warning" aria-hidden />
          {strings.explain.lowConfidence}
        </p>
      )}
    </>
  )
}

const DateFacts = ({ date }: { date: NonNullable<ExplainResponse['date']> }) => (
  <div className="-mx-3 border-y border-rule">
    <FactPair
      facts={[
        {
          label: strings.explain.date,
          note: strings.explain.oldStyle(date.julian),
          value: strings.explain.newStyle(date.gregorian),
        },
        { label: strings.explain.weekday, value: date.weekday },
      ]}
    />
  </div>
)

const Sources = ({ citations }: { citations: Citation[] }) => (
  <ol className="flex flex-col gap-1">
    {distinctSources(citations).map(({ sourceId, title, url, licence, retelling }, index) => (
      <SourceRef
        key={sourceId}
        number={index + 1}
        title={title}
        href={url}
        note={strings.explain.source(licence, retelling)}
      />
    ))}
  </ol>
)

const Answer = ({ response }: { response: ExplainResponse }) => (
  <>
    <AnswerText {...response} />
    {response.date && <DateFacts date={response.date} />}
    {response.citations.length > 0 && <Sources citations={response.citations} />}
  </>
)

type ProblemProps = { problem: RequestFailure; onRetry: () => void; onClose: () => void }

const Problem = ({ problem, onRetry, onClose }: ProblemProps) => (
  <div className="-mx-3">
    <StatusBar {...failureAlertOf(problem, { onRetry, onDismiss: onClose })} />
  </div>
)

export const Explanation = ({ explaining }: { explaining: Explaining }) => {
  const { opened, close, retry } = explaining
  if (!opened) return null
  const { entity, explanation } = opened
  return (
    <ExplainSheet
      label={strings.explain.label[entity.type]}
      title={entity.text}
      closeLabel={strings.explain.close}
      alert={
        explanation.status === 'failed' ? (
          <Problem problem={explanation.problem} onRetry={retry} onClose={close} />
        ) : undefined
      }
      onClose={close}
    >
      {explanation.status === 'loading' && (
        <p className="text-body-14 text-ink-muted">{strings.explain.loading}</p>
      )}
      {explanation.status === 'answered' && <Answer response={explanation.response} />}
    </ExplainSheet>
  )
}

import { CitationSheet, StatusBar, strings } from '@khronist/ui'
import { failureAlertOf } from './failures.ts'
import { useCitation } from './useCitation.ts'
import { useCopy } from './useCopy.ts'

export const refusedCitations = new Set<string>()

type CitationPanelProps = { transcriptionId: string; onClose: () => void }

export const CitationPanel = ({ transcriptionId, onClose }: CitationPanelProps) => {
  const citing = useCitation(transcriptionId)
  const copying = useCopy(citing.text)
  const close = () => {
    if (citing.refused) refusedCitations.add(transcriptionId)
    onClose()
  }
  const copyFailure = { message: strings.cite.copyFailed, offline: false, retryable: true }
  const alert = citing.failure
    ? failureAlertOf(citing.failure, { onRetry: citing.retry, onDismiss: close })
    : copying.failed
      ? failureAlertOf(copyFailure, { onRetry: copying.copy, onDismiss: close })
      : undefined
  return (
    <CitationSheet
      format={citing.format}
      withTranscription={citing.withTranscription}
      text={citing.text}
      loading={citing.loading}
      locked={citing.refused}
      copied={copying.copied}
      alert={alert && <StatusBar {...alert} />}
      onFormatChange={(format) => citing.choose({ format })}
      onWithTranscriptionChange={(withTranscription) => citing.choose({ withTranscription })}
      onCopy={copying.copy}
      onClose={close}
    />
  )
}

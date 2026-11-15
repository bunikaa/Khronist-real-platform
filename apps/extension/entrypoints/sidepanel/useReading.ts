import type {
  Line,
  RecognitionEvent,
  RecognitionState,
  RecognitionStatus,
  Shelfmark,
  Transcription,
} from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiFailure, readRecognition } from '../../api/client.ts'
import type { Fragment, FragmentFailedMessage } from '../../messages.ts'

export type Failure = {
  kind: 'unreadable' | 'retry' | 'size' | 'offline' | 'rejected'
  message: string
}

type Source = { fragment: Fragment; shelfmark: Shelfmark | null }

export type Reading =
  | { phase: 'idle' }
  | ({ phase: 'reading'; status: RecognitionStatus; lines: Line[] } & Source)
  | ({ phase: 'done'; transcription: Transcription } & Source)
  | { phase: 'failed'; fragment?: Fragment; shelfmark: Shelfmark | null; failure: Failure }

const retryCodes = new Set([
  'restarted',
  'save_failed',
  'normalize_failed',
  'reader_unavailable',
  'shutting_down',
  'internal_error',
  'stalled',
])
const sizeCodes = new Set(['too_large', 'bad_image'])

const failureFor = (code: string | undefined, message: string): Failure => {
  if (code === 'read_failed') return { kind: 'unreadable', message }
  if (code !== undefined && sizeCodes.has(code))
    return { kind: 'size', message: strings.read.tooLarge }
  if (code !== undefined && retryCodes.has(code)) return { kind: 'retry', message }
  return { kind: 'rejected', message }
}

export const applyEvent = (
  reading: Extract<Reading, { phase: 'reading' }>,
  event: RecognitionEvent,
): Extract<Reading, { phase: 'reading' }> => {
  if (event.event === 'progress') return { ...reading, status: event.data.status }
  if (event.event === 'line') {
    const { line } = event.data
    const lines = [...reading.lines.filter((known) => known.idx !== line.idx), line]
    return { ...reading, lines: lines.sort((a, b) => a.idx - b.idx) }
  }
  return reading
}

export const finished = (source: Source, state: RecognitionState): Reading => {
  if (state.status === 'done' && state.transcription) {
    return { phase: 'done', ...source, transcription: state.transcription }
  }
  return {
    phase: 'failed',
    ...source,
    failure: failureFor(state.error?.code, state.error?.message ?? strings.read.badResponse),
  }
}

export const failureOf = (error: unknown): Failure => {
  if (error instanceof ApiFailure) return failureFor(error.code, error.message)
  if (error instanceof TypeError) return { kind: 'offline', message: strings.read.offline }
  return { kind: 'rejected', message: strings.read.badResponse }
}

export const useReading = () => {
  const [reading, setReading] = useState<Reading>({ phase: 'idle' })
  const controller = useRef<AbortController>(undefined)
  const last = useRef<Source>(undefined)

  const start = useCallback((fragment: Fragment, shelfmark: Shelfmark | null) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    const source = { fragment, shelfmark }
    last.current = source
    setReading({ phase: 'reading', ...source, status: 'queued', lines: [] })

    const onEvent = (event: RecognitionEvent) => {
      if (current.signal.aborted) return
      setReading((previous) =>
        previous.phase === 'reading' ? applyEvent(previous, event) : previous,
      )
    }

    readRecognition(
      {
        shelfmark: shelfmark ?? undefined,
        image: { base64Png: fragment.base64Png },
        box: fragment.box,
        imageHash: fragment.imageHash,
        source: 'extension',
      },
      current.signal,
      onEvent,
    ).then(
      (state) => {
        if (!current.signal.aborted) setReading(finished(source, state))
      },
      (error: unknown) => {
        if (!current.signal.aborted)
          setReading({ phase: 'failed', ...source, failure: failureOf(error) })
      },
    )
  }, [])

  const retry = useCallback(() => {
    if (last.current) start(last.current.fragment, last.current.shelfmark)
  }, [start])

  const failSelection = useCallback(
    (reason: FragmentFailedMessage['reason'], shelfmark: Shelfmark | null) => {
      setReading((previous) =>
        previous.phase === 'reading'
          ? previous
          : {
              phase: 'failed',
              shelfmark,
              failure: { kind: 'rejected', message: strings.read.fragmentFailed[reason] },
            },
      )
    },
    [],
  )

  const cancel = useCallback(() => {
    controller.current?.abort()
    setReading({ phase: 'idle' })
  }, [])

  useEffect(() => () => controller.current?.abort(), [])

  return { reading, start, retry, failSelection, cancel }
}

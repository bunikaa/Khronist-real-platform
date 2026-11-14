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
import type { Fragment } from '../../messages.ts'

export type Failure = { kind: 'unreadable' | 'offline' | 'rejected'; message: string }

export type Reading =
  | { phase: 'idle' }
  | { phase: 'reading'; fragment: Fragment; status: RecognitionStatus; lines: Line[] }
  | { phase: 'done'; transcription: Transcription }
  | { phase: 'failed'; fragment: Fragment; failure: Failure }

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

export const finished = (fragment: Fragment, state: RecognitionState): Reading => {
  if (state.status === 'done' && state.transcription) {
    return { phase: 'done', transcription: state.transcription }
  }
  return {
    phase: 'failed',
    fragment,
    failure: { kind: 'unreadable', message: state.error?.message ?? strings.read.badResponse },
  }
}

export const failureOf = (error: unknown): Failure => {
  if (error instanceof ApiFailure) return { kind: 'rejected', message: error.message }
  if (error instanceof TypeError) return { kind: 'offline', message: strings.read.offline }
  return { kind: 'rejected', message: strings.read.badResponse }
}

export const useReading = () => {
  const [reading, setReading] = useState<Reading>({ phase: 'idle' })
  const controller = useRef<AbortController>(undefined)

  const start = useCallback((fragment: Fragment, shelfmark: Shelfmark | null) => {
    controller.current?.abort()
    const current = new AbortController()
    controller.current = current
    setReading({ phase: 'reading', fragment, status: 'queued', lines: [] })

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
        if (!current.signal.aborted) setReading(finished(fragment, state))
      },
      (error: unknown) => {
        if (!current.signal.aborted)
          setReading({ phase: 'failed', fragment, failure: failureOf(error) })
      },
    )
  }, [])

  const cancel = useCallback(() => {
    controller.current?.abort()
    setReading({ phase: 'idle' })
  }, [])

  useEffect(() => () => controller.current?.abort(), [])

  return { reading, start, cancel }
}

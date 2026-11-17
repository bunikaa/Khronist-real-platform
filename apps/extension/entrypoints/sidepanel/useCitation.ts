import type { CiteRequest } from '@khronist/contracts'
import { useEffect, useRef, useState } from 'react'
import { citeTranscription } from '../../api/cite.ts'
import { requestFailureOf, type RequestFailure } from './failures.ts'

const citeTimeoutMs = 15_000

type Choice = Omit<CiteRequest, 'transcriptionId'>

type CitationState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'failed'; failure: RequestFailure }

const firstChoice: Choice = { format: 'dstu', withTranscription: true }

const keyOf = ({ format, withTranscription }: Choice) => `${format}:${withTranscription}`

const useCitationRequests = (transcriptionId: string) => {
  const [citations, setCitations] = useState<ReadonlyMap<string, CitationState>>(
    () => new Map([[keyOf(firstChoice), { status: 'loading' }]]),
  )
  const [refusal, setRefusal] = useState<RequestFailure>()
  const open = useRef<AbortController>(null)

  const save = (key: string, citation: CitationState) =>
    setCitations((current) => new Map(current).set(key, citation))

  const load = (choice: Choice) => {
    const sheet = open.current
    if (!sheet) return
    const key = keyOf(choice)
    save(key, { status: 'loading' })
    const signal = AbortSignal.any([sheet.signal, AbortSignal.timeout(citeTimeoutMs)])
    citeTranscription({ transcriptionId, ...choice }, signal).then(
      (text) => save(key, { status: 'ready', text }),
      (error: unknown) => {
        if (sheet.signal.aborted) return
        const failure = requestFailureOf(error)
        if (failure.retryable) save(key, { status: 'failed', failure })
        else setRefusal(failure)
      },
    )
  }

  useEffect(() => {
    const sheet = new AbortController()
    open.current = sheet
    load(firstChoice)
    return () => sheet.abort()
  }, [])

  return { citations, refusal, load }
}

export const useCitation = (transcriptionId: string) => {
  const [choice, setChoice] = useState(firstChoice)
  const { citations, refusal, load } = useCitationRequests(transcriptionId)

  const choose = (change: Partial<Choice>) => {
    const next = { ...choice, ...change }
    setChoice(next)
    const known = citations.get(keyOf(next))
    if (!known || known.status === 'failed') load(next)
  }

  const citation = refusal ? undefined : citations.get(keyOf(choice))
  return {
    ...choice,
    text: citation?.status === 'ready' ? citation.text : undefined,
    loading: citation?.status === 'loading',
    failure: refusal ?? (citation?.status === 'failed' ? citation.failure : undefined),
    refused: refusal !== undefined,
    choose,
    retry: () => load(choice),
  }
}

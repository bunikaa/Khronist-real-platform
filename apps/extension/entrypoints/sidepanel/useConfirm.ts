import type { Transcription } from '@khronist/contracts'
import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { ApiFailure } from '../../api/client.ts'
import { verifyTranscription } from '../../api/transcriptions.ts'
import { problemOf, type RequestProblem } from './failures.ts'
import type { LineEditing } from './useLineEditing.ts'
import type { Session } from './useSession.ts'

const dontAskKey = 'confirmWithoutAsking'
const confirmTimeoutMs = 20_000

const useDontAsk = () => {
  const [dontAsk, setDontAsk] = useState(false)
  useEffect(() => {
    browser.storage.local.get(dontAskKey).then(
      (stored) => setDontAsk(stored[dontAskKey] === true),
      () => undefined,
    )
  }, [])
  const remember = useCallback(() => {
    setDontAsk(true)
    browser.storage.local.set({ [dontAskKey]: true }).catch(() => undefined)
  }, [])
  return [dontAsk, remember] as const
}

type ConfirmState = {
  versionId: string | undefined
  asking: boolean
  ticked: boolean
  sending: boolean
  problem: RequestProblem | undefined
}

const idle = (versionId: string | undefined): ConfirmState => ({
  versionId,
  asking: false,
  ticked: false,
  sending: false,
  problem: undefined,
})

type ConfirmOptions = {
  transcription: Transcription | undefined
  session: Session
  editing: LineEditing
  onConfirmed: (transcription: Transcription) => void
  onForbidden: () => void
  shown: boolean
  hidden: boolean
}

export const useConfirm = (options: ConfirmOptions) => {
  const { transcription, session, editing, onConfirmed, onForbidden, shown, hidden } = options
  const versionId = transcription?.id
  const [stored, setStored] = useState(() => idle(versionId))
  const state = stored.versionId === versionId ? stored : idle(versionId)
  const [dontAsk, rememberDontAsk] = useDontAsk()
  const [confirmedHere, setConfirmedHere] = useState<ReadonlySet<string>>(new Set())
  const answer = (forVersion: string, change: Partial<ConfirmState>) =>
    setStored((current) => (current.versionId === forVersion ? { ...current, ...change } : current))
  const changeShown = (change: Partial<ConfirmState>) =>
    setStored((current) => ({
      ...(current.versionId === versionId ? current : idle(versionId)),
      ...change,
    }))

  const signedIn = session.status === 'signed-in' ? session : undefined
  const busyEditing = Boolean(editing.editing || editing.unsaved || editing.problem)
  const blocked = state.problem !== undefined && state.problem.kind !== 'failed'
  const available =
    signedIn?.canVerify === true &&
    transcription?.status === 'draft' &&
    transcription.shelfmark !== undefined &&
    !busyEditing &&
    !blocked
  const asking = state.asking && available && shown

  useEffect(() => {
    if (!busyEditing) return
    setStored((current) => ({
      ...current,
      asking: false,
      problem: current.problem?.kind === 'conflict' ? current.problem : undefined,
    }))
  }, [busyEditing])

  useEffect(() => {
    if (!shown) setStored((current) => ({ ...current, asking: false }))
  }, [shown])

  useEffect(() => {
    if (session.status !== 'signed-in') return
    setStored((current) =>
      current.problem?.kind === 'signed-out' ? { ...current, problem: undefined } : current,
    )
  }, [session])

  useEffect(() => {
    if (!asking || hidden || state.sending) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setStored((current) => ({ ...current, asking: false }))
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [asking, hidden, state.sending])

  const send = () => {
    if (!transcription || !signedIn || !available || state.sending) return
    if (asking && state.ticked) rememberDontAsk()
    const sentFor = transcription.id
    changeShown({ sending: true, problem: undefined })
    verifyTranscription(
      transcription,
      signedIn.user.name,
      AbortSignal.timeout(confirmTimeoutMs),
    ).then(
      (confirmed) => {
        answer(sentFor, idle(sentFor))
        setConfirmedHere((ids) => new Set([...ids, sentFor]))
        onConfirmed(confirmed)
      },
      async (error: unknown) => {
        const problem = await problemOf(error)
        answer(sentFor, { sending: false, asking: false, problem })
        if (error instanceof ApiFailure && error.code === 'forbidden') onForbidden()
      },
    )
  }

  const showCurrent = () => {
    if (state.problem?.kind === 'conflict') onConfirmed(state.problem.current)
  }

  return {
    available,
    asking,
    sending: state.sending,
    confirmedHere,
    problem: state.problem,
    ticked: state.ticked,
    signature: signedIn?.user.name ?? '',
    tick: (ticked: boolean) => changeShown({ ticked }),
    start: () => (dontAsk ? send() : changeShown({ asking: true, ticked: false })),
    confirm: send,
    cancel: () => changeShown({ asking: false }),
    retry: send,
    dismiss: () => changeShown({ problem: undefined }),
    showCurrent,
  }
}

export type Confirming = ReturnType<typeof useConfirm>

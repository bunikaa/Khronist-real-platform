import type { Transcription } from '@khronist/contracts'
import { strings } from '@khronist/ui'
import { useEffect, useReducer, useRef, type ActionDispatch } from 'react'
import { ApiFailure, VersionConflictFailure } from '../../api/client.ts'
import { readToken } from '../../api/token.ts'
import { saveLines, type LineChange } from '../../api/transcriptions.ts'
import {
  editReducer,
  initialEdit,
  shownLines,
  type EditAction,
  type EditState,
} from './lineEditing.ts'
import type { Session } from './useSession.ts'

const saveTimeoutMs = 20_000
const retryableCodes = new Set(['too_many_requests', 'internal_error', 'shutting_down'])

export const answerOf = async (error: unknown, regionId: string): Promise<EditAction> => {
  if (error instanceof VersionConflictFailure)
    return { type: 'conflict', regionId, current: error.current }
  const unauthorized = error instanceof ApiFailure && error.code === 'unauthorized'
  if (unauthorized && (await readToken()) === undefined) return { type: 'unauthorized', regionId }
  if (error instanceof ApiFailure) {
    const retryable = unauthorized || retryableCodes.has(error.code)
    return { type: 'failed', regionId, message: error.message, offline: false, retryable }
  }
  const offline =
    error instanceof TypeError || (error instanceof DOMException && error.name === 'TimeoutError')
  const message = offline ? strings.read.offline : strings.read.badResponse
  return { type: 'failed', regionId, message, offline, retryable: true }
}

type SavedText = (idx: number) => string

const unsent = (state: EditState, saved: SavedText): LineChange[] => {
  const { editing, pending } = state
  const open = editing && editing.text !== saved(editing.idx) ? [editing] : []
  return [...pending.filter((change) => change.idx !== editing?.idx), ...open]
}

type SaveQueueOptions = {
  transcription: Transcription | undefined
  signedIn: boolean | undefined
  state: EditState
  dispatch: ActionDispatch<[EditAction]>
  onSaved: (transcription: Transcription) => void
  saved: SavedText
}

const useLastSaveOnLeave = ({ transcription, signedIn, state, saved }: SaveQueueOptions) => {
  const regionId = transcription?.regionId
  const inFlight = useRef<Promise<Transcription | undefined>>(undefined)
  const last = useRef({ transcription, signedIn, changes: [] as LineChange[] })
  useEffect(() => {
    last.current = { transcription, signedIn, changes: unsent(state, saved) }
  })
  useEffect(
    () => () => {
      const { transcription, signedIn, changes } = last.current
      if (!transcription || signedIn !== true || changes.length === 0) return
      void (inFlight.current ?? Promise.resolve(undefined))
        .then((done) =>
          saveLines(done ?? transcription, changes, AbortSignal.timeout(saveTimeoutMs)),
        )
        .catch(() => undefined)
    },
    [regionId],
  )
  return inFlight
}

const useSaveQueue = (options: SaveQueueOptions) => {
  const { transcription, signedIn, state, dispatch, onSaved } = options
  const inFlight = useLastSaveOnLeave(options)
  const { pending, sending, problem, unauthorized, editing } = state
  const idle = !sending && !problem && !unauthorized && !editing
  useEffect(() => {
    if (!transcription || signedIn !== true || !idle || pending.length === 0) return
    const { regionId } = transcription
    dispatch({ type: 'send', changes: pending })
    const request = saveLines(transcription, pending, AbortSignal.timeout(saveTimeoutMs))
    inFlight.current = request.catch(() => undefined)
    request.then(
      (done) => {
        onSaved(done)
        dispatch({ type: 'saved', regionId, changes: pending })
      },
      async (error: unknown) => dispatch(await answerOf(error, regionId)),
    )
  }, [transcription, signedIn, idle, pending, dispatch, onSaved, inFlight])
}

type LineEditingOptions = {
  transcription: Transcription | undefined
  session: Session
  onSaved: (transcription: Transcription) => void
  onSignInNeeded: () => void
}

export const useLineEditing = ({ session, onSignInNeeded, ...options }: LineEditingOptions) => {
  const { transcription, onSaved } = options
  const signedIn = session.status === 'loading' ? undefined : session.status === 'signed-in'
  const [state, dispatch] = useReducer(editReducer, initialEdit)
  if (state.regionId !== transcription?.regionId)
    dispatch({ type: 'reset', regionId: transcription?.regionId })
  useEffect(() => dispatch({ type: 'session-changed' }), [session])

  const saved: SavedText = (idx) =>
    transcription?.lines.find((line) => line.idx === idx)?.text ?? ''
  useSaveQueue({ ...options, signedIn, state, dispatch, saved })

  const guestQueue = signedIn === false && state.pending.length > 0
  const waitingForSignIn = guestQueue && !state.editing
  const asked = useRef(false)
  useEffect(() => {
    if (!guestQueue) asked.current = false
    else if (waitingForSignIn && !asked.current) {
      asked.current = true
      onSignInNeeded()
    }
  }, [guestQueue, waitingForSignIn, onSignInNeeded])

  const lines = transcription ? shownLines(transcription, state) : []
  return {
    ...editActions(state, dispatch, lines, saved, onSaved),
    editing: state.editing,
    problem: state.problem,
    lines,
    waitingForSignIn,
    unsaved: unsent(state, saved).length > 0,
    editable: state.problem?.kind !== 'conflict',
  }
}

const editActions = (
  state: EditState,
  dispatch: ActionDispatch<[EditAction]>,
  lines: ReturnType<typeof shownLines>,
  saved: SavedText,
  onSaved: (transcription: Transcription) => void,
) => {
  const { editing, problem } = state
  const commit = () => {
    if (editing) dispatch({ type: 'commit', idx: editing.idx, saved: saved(editing.idx) })
  }
  const open = (idx: number) => {
    commit()
    const shown = lines.find(({ line }) => line.idx === idx)
    if (shown) dispatch({ type: 'open', idx, text: shown.line.text })
  }
  const next = () => {
    const position = lines.findIndex(({ line }) => line.idx === editing?.idx)
    const following = lines[position + 1]
    if (following) open(following.line.idx)
    else commit()
  }
  const showCurrent = () => {
    if (problem?.kind !== 'conflict') return
    onSaved(problem.current)
    dispatch({ type: 'resolve' })
  }
  return {
    open,
    commit,
    next,
    showCurrent,
    change: (text: string) => dispatch({ type: 'change', text }),
    cancel: () => dispatch({ type: 'cancel' }),
    retry: () => dispatch({ type: 'retry' }),
    discard: () => dispatch({ type: 'discard' }),
  }
}

export type LineEditing = ReturnType<typeof useLineEditing>

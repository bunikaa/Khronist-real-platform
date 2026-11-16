import type { Line, Transcription } from '@khronist/contracts'
import type { LineChange } from '../../api/transcriptions.ts'

type SaveFailure = { message: string; offline: boolean; retryable: boolean }

type EditProblem = { kind: 'conflict'; current: Transcription } | ({ kind: 'failed' } & SaveFailure)

export type EditState = {
  regionId: string | undefined
  editing: LineChange | undefined
  pending: LineChange[]
  sending: LineChange[] | undefined
  changed: number[]
  problem: EditProblem | undefined
  unauthorized: boolean
}

type Answer =
  | { type: 'saved'; changes: LineChange[] }
  | ({ type: 'failed' } & SaveFailure)
  | { type: 'conflict'; current: Transcription }
  | { type: 'unauthorized' }

export type EditAction =
  | { type: 'reset'; regionId: string | undefined }
  | { type: 'open'; idx: number; text: string }
  | { type: 'change'; text: string }
  | { type: 'commit'; idx: number; saved: string }
  | { type: 'cancel' }
  | { type: 'send'; changes: LineChange[] }
  | (Answer & { regionId: string })
  | { type: 'session-changed' }
  | { type: 'resolve' }
  | { type: 'discard' }
  | { type: 'retry' }

export const initialEdit: EditState = {
  regionId: undefined,
  editing: undefined,
  pending: [],
  sending: undefined,
  changed: [],
  problem: undefined,
  unauthorized: false,
}

const lineBreaks = /\r\n?|\n/g
const loneSurrogates = /\p{Cs}/gu
const nul = String.fromCharCode(0)

export const cleanLineText = (text: string) =>
  text.replace(lineBreaks, ' ').replace(loneSurrogates, '').replaceAll(nul, '')

const sameChange = (a: LineChange) => (b: LineChange) => a.idx === b.idx && a.text === b.text

const commit = (state: EditState, idx: number, saved: string): EditState => {
  if (state.editing?.idx !== idx) return state
  const others = state.pending.filter((change) => change.idx !== idx)
  const { text } = state.editing
  const inFlight = state.sending?.some((change) => change.idx === idx) ?? false
  return {
    ...state,
    editing: undefined,
    pending: text === saved && !inFlight ? others : [...others, { idx, text }],
  }
}

const answer = (state: EditState, action: Answer): EditState => {
  switch (action.type) {
    case 'saved':
      return {
        ...state,
        sending: undefined,
        pending: state.pending.filter((change) => !action.changes.some(sameChange(change))),
        changed: [...new Set([...state.changed, ...action.changes.map((change) => change.idx)])],
      }
    case 'failed': {
      const { message, offline, retryable } = action
      return {
        ...state,
        sending: undefined,
        problem: { kind: 'failed', message, offline, retryable },
      }
    }
    case 'conflict':
      return {
        ...state,
        editing: undefined,
        sending: undefined,
        problem: { kind: 'conflict', current: action.current },
      }
    case 'unauthorized':
      return { ...state, sending: undefined, unauthorized: true }
  }
}

export const editReducer = (state: EditState, action: EditAction): EditState => {
  switch (action.type) {
    case 'reset':
      return { ...initialEdit, regionId: action.regionId }
    case 'open':
      if (state.problem?.kind === 'conflict') return state
      return { ...state, editing: { idx: action.idx, text: action.text } }
    case 'change':
      if (!state.editing) return state
      return { ...state, editing: { ...state.editing, text: cleanLineText(action.text) } }
    case 'commit':
      return commit(state, action.idx, action.saved)
    case 'cancel':
      return { ...state, editing: undefined }
    case 'send':
      return { ...state, sending: action.changes }
    case 'session-changed':
      return { ...state, unauthorized: false }
    case 'resolve':
      return { ...state, editing: undefined, pending: [], changed: [], problem: undefined }
    case 'discard':
      return { ...state, editing: undefined, pending: [], problem: undefined }
    case 'retry':
      return { ...state, problem: undefined }
    default:
      return action.regionId === state.regionId ? answer(state, action) : state
  }
}

type ShownLine = { line: Line; changed: boolean }

export const shownLines = (transcription: Transcription, state: EditState): ShownLine[] =>
  transcription.lines.map((line) => {
    const queued = state.pending.find((change) => change.idx === line.idx)
    const changed = queued !== undefined || state.changed.includes(line.idx)
    return queued
      ? { changed, line: { ...line, text: queued.text, uncertain: false, words: [] } }
      : { changed, line }
  })

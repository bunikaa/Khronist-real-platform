import type { Line, Transcription } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import {
  editReducer,
  initialEdit,
  shownLines,
  type EditState,
} from '../entrypoints/sidepanel/lineEditing.ts'

const regionId = '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d'

const line = (idx: number, text: string, uncertain = false): Line => ({
  idx,
  text,
  box: { x: 0, y: idx / 3, w: 1, h: 1 / 3 },
  boxSource: 'estimated',
  uncertain,
  words: text.split(' ').map((word) => ({ text: word, uncertain })),
})

const transcription: Transcription = {
  id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
  regionId,
  box: { x: 0, y: 0, w: 1, h: 1 },
  version: 1,
  status: 'draft',
  lines: [line(0, 'Села Борщаговки'), line(1, 'Коваленко и законная', true), line(2, 'оба')],
  normalizedText: '',
  entities: [],
  reader: 'claude-sonnet-5-5',
  createdAt: '2026-11-14T12:00:00.000Z',
}

const open: EditState = { ...initialEdit, regionId }
const change = { idx: 1, text: 'Коваленко и законная жена' }

describe('editReducer', () => {
  it.each<[string, EditState, Parameters<typeof editReducer>[1], Partial<EditState>]>([
    [
      'opens a line with its shown text',
      open,
      { type: 'open', idx: 1, text: 'Коваленко и законная' },
      { editing: { idx: 1, text: 'Коваленко и законная' } },
    ],
    [
      'keeps a conflict on screen instead of opening a line',
      { ...open, problem: { kind: 'conflict', current: transcription } },
      { type: 'open', idx: 1, text: 'Коваленко и законная' },
      { editing: undefined },
    ],
    [
      'follows the typing',
      { ...open, editing: { idx: 1, text: 'Коваленко' } },
      { type: 'change', text: 'Коваленко и' },
      { editing: { idx: 1, text: 'Коваленко и' } },
    ],
    [
      'turns a typed line break into a space',
      { ...open, editing: { idx: 1, text: '' } },
      { type: 'change', text: 'Коваленко\r\nи законная' },
      { editing: { idx: 1, text: 'Коваленко и законная' } },
    ],
    [
      'queues a changed line on commit',
      { ...open, editing: change },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { editing: undefined, pending: [change] },
    ],
    [
      'queues nothing when the line is as saved',
      { ...open, editing: { idx: 1, text: 'Коваленко и законная' } },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { editing: undefined, pending: [] },
    ],
    [
      'drops a queued change the reader typed back',
      { ...open, editing: { idx: 1, text: 'Коваленко и законная' }, pending: [change] },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { pending: [] },
    ],
    [
      'queues a line typed back while its change is on the way',
      {
        ...open,
        editing: { idx: 1, text: 'Коваленко и законная' },
        pending: [change],
        sending: [change],
      },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { pending: [{ idx: 1, text: 'Коваленко и законная' }] },
    ],
    [
      'keeps a line on the way queued when it is reopened and left unchanged',
      { ...open, editing: change, pending: [change], sending: [change] },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { pending: [change] },
    ],
    [
      'drops the characters the API refuses and turns line breaks into spaces',
      { ...open, editing: { idx: 1, text: '' } },
      { type: 'change', text: 'Коваленко\u0000\r\nи \uD800законная' },
      { editing: { idx: 1, text: 'Коваленко и законная' } },
    ],
    [
      'replaces a queued change of the same line',
      { ...open, editing: { idx: 1, text: 'Коваленко' }, pending: [change] },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { pending: [{ idx: 1, text: 'Коваленко' }] },
    ],
    [
      'ignores a commit of a line that is no longer open',
      { ...open, editing: { idx: 2, text: 'оба' } },
      { type: 'commit', idx: 1, saved: 'Коваленко и законная' },
      { editing: { idx: 2, text: 'оба' } },
    ],
    [
      'drops the open text on cancel and keeps the queue',
      { ...open, editing: change, pending: [{ idx: 0, text: 'Села' }] },
      { type: 'cancel' },
      { editing: undefined, pending: [{ idx: 0, text: 'Села' }] },
    ],
    [
      'remembers what is on the way',
      { ...open, pending: [change] },
      { type: 'send', changes: [change] },
      { sending: [change], pending: [change] },
    ],
    [
      'marks the saved lines and keeps a newer text of the same line queued',
      { ...open, pending: [{ idx: 1, text: 'новіше' }], sending: [change] },
      { type: 'saved', regionId, changes: [change] },
      { sending: undefined, pending: [{ idx: 1, text: 'новіше' }], changed: [1] },
    ],
    [
      'forgets an answer for another fragment',
      { ...open, pending: [change], sending: [change] },
      { type: 'saved', regionId: 'another-region', changes: [change] },
      { sending: [change], pending: [change], changed: [] },
    ],
    [
      'keeps the queue for a retry after a failure',
      { ...open, pending: [change], sending: [change] },
      { type: 'failed', regionId, message: 'Запит завеликий', offline: false, retryable: false },
      {
        sending: undefined,
        pending: [change],
        problem: { kind: 'failed', message: 'Запит завеликий', offline: false, retryable: false },
      },
    ],
    [
      'keeps the queue until the reader signs in again',
      { ...open, pending: [change], sending: [change] },
      { type: 'unauthorized', regionId },
      { sending: undefined, pending: [change], problem: undefined, unauthorized: true },
    ],
    [
      'sends again only after the panel learns the session is gone',
      { ...open, pending: [change], unauthorized: true },
      { type: 'session-changed' },
      { pending: [change], unauthorized: false },
    ],
    [
      'drops the queue on request and keeps the marks of saved lines',
      {
        ...open,
        pending: [change],
        changed: [0],
        problem: { kind: 'failed', message: 'x', offline: false, retryable: false },
      },
      { type: 'discard' },
      { pending: [], changed: [0], problem: undefined },
    ],
    [
      'stops editing on a conflict',
      { ...open, editing: { idx: 2, text: 'оба' }, pending: [change], sending: [change] },
      { type: 'conflict', regionId, current: transcription },
      {
        editing: undefined,
        sending: undefined,
        problem: { kind: 'conflict', current: transcription },
      },
    ],
    [
      'drops the edits when the reader takes the newer version',
      {
        ...open,
        pending: [change],
        changed: [0],
        problem: { kind: 'conflict', current: transcription },
      },
      { type: 'resolve' },
      { pending: [], changed: [], problem: undefined },
    ],
    [
      'clears a failure for a retry',
      {
        ...open,
        pending: [change],
        problem: { kind: 'failed', message: 'Запит завеликий', offline: false, retryable: false },
      },
      { type: 'retry' },
      { pending: [change], problem: undefined },
    ],
    [
      'starts over for another fragment',
      { ...open, editing: change, pending: [change], changed: [1] },
      { type: 'reset', regionId: 'another-region' },
      { ...initialEdit, regionId: 'another-region' },
    ],
  ])('%s', (_case, state, action, expected) => {
    expect(editReducer(state, action)).toMatchObject(expected)
  })
})

describe('shownLines', () => {
  it('shows a queued text without the words and doubts the model had for the old one', () => {
    const lines = shownLines(transcription, { ...open, pending: [change], changed: [0] })

    expect(lines[0]).toMatchObject({ changed: true, line: transcription.lines[0] })
    expect(lines[1]).toEqual({
      changed: true,
      line: { ...transcription.lines[1], text: change.text, uncertain: false, words: [] },
    })
    expect(lines[2]).toMatchObject({ changed: false, line: transcription.lines[2] })
  })
})

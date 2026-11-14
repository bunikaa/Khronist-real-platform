import type { Line, Transcription } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { ApiFailure } from '../api/client.ts'
import type { Fragment } from '../messages.ts'
import { modernText } from '../entrypoints/sidepanel/screens.tsx'
import { applyEvent, failureOf, finished } from '../entrypoints/sidepanel/useReading.ts'

const fragment: Fragment = {
  base64Png: 'iVBORw0KGgo=',
  imageHash: 'a'.repeat(64),
  box: { x: 0.5, y: 0.3, w: 0.25, h: 0.1 },
  width: 750,
  height: 249,
}

const lineAt = (idx: number, text: string): Line => ({
  idx,
  text,
  box: { x: 0, y: 0, w: 1, h: 1 },
  boxSource: 'estimated',
  uncertain: false,
  words: [],
})

const reading = { phase: 'reading' as const, fragment, status: 'queued' as const, lines: [] }

describe('applyEvent', () => {
  it('tracks the status and keeps lines ordered without duplicates on a replay', () => {
    let state = applyEvent(reading, { event: 'progress', data: { status: 'reading' } })
    state = applyEvent(state, { event: 'line', data: { line: lineAt(1, 'друга') } })
    state = applyEvent(state, { event: 'line', data: { line: lineAt(0, 'перша') } })
    state = applyEvent(state, { event: 'line', data: { line: lineAt(1, 'друга') } })

    expect(state.status).toBe('reading')
    expect(state.lines.map((line) => line.text)).toEqual(['перша', 'друга'])
  })
})

describe('finished', () => {
  it('shows the server reason when reading failed', () => {
    expect(
      finished(fragment, {
        recognitionId: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
        status: 'failed',
        error: { code: 'read_failed', message: 'Не вдалося прочитати фрагмент' },
      }),
    ).toEqual({
      phase: 'failed',
      fragment,
      failure: { kind: 'unreadable', message: 'Не вдалося прочитати фрагмент' },
    })
  })
})

describe('failureOf', () => {
  it('tells a lost connection from a refusal of the API', () => {
    expect(failureOf(new TypeError('Failed to fetch')).kind).toBe('offline')
    expect(failureOf(new ApiFailure('too_large', 'Зображення завелике'))).toEqual({
      kind: 'rejected',
      message: 'Зображення завелике',
    })
  })
})

describe('modernText', () => {
  const transcription: Transcription = {
    id: '5f1d7c1e-4a0b-4d3c-9a43-2c1e7b0f9a11',
    regionId: '8a2b3c4d-5e6f-4a1b-8c9d-0e1f2a3b4c5d',
    box: { x: 0, y: 0, w: 1, h: 1 },
    version: 1,
    status: 'draft',
    lines: [lineAt(0, 'Села Борщаговки крестьянинъ'), lineAt(1, 'Іоаннъ Петровъ')],
    normalizedText: 'Села Борщаговки крестьянинъ\nІоаннъ Петровъ',
    entities: [],
    reader: 'claude-sonnet-5-5',
    createdAt: '2026-11-14T12:00:00.000Z',
  }

  it('hides the raw text that the server returned without normalizing it', () => {
    expect(modernText(transcription)).toBeNull()
  })

  it('shows the text once the server has really modernized it', () => {
    expect(
      modernText({ ...transcription, normalizedText: 'Села Борщагівки селянин Іван Петров' }),
    ).toBe('Села Борщагівки селянин Іван Петров')
  })
})

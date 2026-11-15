import type { Line, Transcription } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { ApiFailure } from '../api/client.ts'
import type { Fragment } from '../messages.ts'
import { modernLines } from '../entrypoints/sidepanel/screens.tsx'
import { applyEvent, failureOf, finished } from '../entrypoints/sidepanel/useReading.ts'

const fragment: Fragment = {
  base64Png: 'iVBORw0KGgo=',
  imageHash: 'a'.repeat(64),
  box: { x: 0.5, y: 0.3, w: 0.25, h: 0.1 },
  width: 750,
  height: 249,
}

const source = { fragment, shelfmark: null }

const lineAt = (idx: number, text: string): Line => ({
  idx,
  text,
  box: { x: 0, y: 0, w: 1, h: 1 },
  boxSource: 'estimated',
  uncertain: false,
  words: [],
})

const reading = { phase: 'reading' as const, ...source, status: 'queued' as const, lines: [] }

const failedWith = (code: string, message: string) =>
  finished(source, {
    recognitionId: '0b6a9d3e-1c2f-4e5a-8b7c-9d0e1f2a3b4c',
    status: 'failed',
    error: { code: code as 'read_failed', message },
  })

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
  it('gives reading tips only when the fragment could not be read', () => {
    expect(failedWith('read_failed', 'Не вдалося прочитати фрагмент')).toEqual({
      phase: 'failed',
      ...source,
      failure: { kind: 'unreadable', message: 'Не вдалося прочитати фрагмент' },
    })
  })

  it('offers a plain retry after a restart, a failed save or a failed normalization', () => {
    for (const code of ['restarted', 'save_failed', 'normalize_failed']) {
      const state = failedWith(code, 'причина')
      expect(state.phase === 'failed' && state.failure, code).toEqual({
        kind: 'retry',
        message: 'причина',
      })
    }
  })

  it('suggests a smaller selection when the image is too large or broken', () => {
    for (const code of ['too_large', 'bad_image']) {
      const state = failedWith(code, 'Зображення завелике')
      expect(state.phase === 'failed' && state.failure.kind, code).toBe('size')
    }
  })
})

describe('failureOf', () => {
  it('tells a lost connection from a refusal of the API', () => {
    expect(failureOf(new TypeError('Failed to fetch')).kind).toBe('offline')
    expect(failureOf(new ApiFailure('too_many_requests', 'Ліміт'))).toEqual({
      kind: 'rejected',
      message: 'Ліміт',
    })
    expect(failureOf(new ApiFailure('stalled', 'x')).kind).toBe('retry')
    expect(failureOf(new ApiFailure('shutting_down', 'Сервер перезапускається')).kind).toBe('retry')
  })
})

describe('modernLines', () => {
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
  const words = (text: string) => text.split(' ').map((word) => ({ text: word, uncertain: false }))

  it('hides the text that the server did not normalize', () => {
    expect(modernLines(transcription)).toBeNull()
    const same = transcription.lines.map((line) => ({ text: line.text, words: words(line.text) }))
    expect(modernLines({ ...transcription, normalizedLines: same })).toBeNull()
  })

  it('shows the lines once the server has really modernized them', () => {
    const normalizedLines = [
      { text: 'Села Борщаговки крестьянин', words: words('Села Борщаговки крестьянин') },
      { text: 'Иоанн Петров', words: words('Иоанн Петров') },
    ]
    expect(modernLines({ ...transcription, normalizedLines })).toBe(normalizedLines)
  })
})

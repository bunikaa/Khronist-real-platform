import type { Line, Transcription } from '@khronist/contracts'
import { describe, expect, it } from 'vitest'
import { ApiFailure } from '../api/client.ts'
import type { Fragment } from '../messages.ts'
import { readableText } from '../entrypoints/sidepanel/result.tsx'
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

  it('shows the server message and reading tips when the fragment has no text', () => {
    const message = 'На фрагменті не знайдено тексту. Виділіть ділянку із записом'
    expect(failedWith('no_text', message)).toEqual({
      phase: 'failed',
      ...source,
      failure: { kind: 'unreadable', message },
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

describe('readableText', () => {
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

  const same = transcription.lines.map((line) => ({ text: line.text, words: words(line.text) }))
  const normalizedLines = [
    { text: 'Села Борщаговки крестьянин', words: words('Села Борщаговки крестьянин') },
    { text: 'Иоанн Петров', words: words('Иоанн Петров') },
  ]
  const translatedLines = ['Села Борщагівки селянин', 'Іван Петрович']
  const expansions = [{ from: 'крестьянинъ', to: 'крестьянин' }]
  const normalized = {
    kind: 'normalized' as const,
    lines: normalizedLines,
    expansions: [] as typeof expansions,
  }
  const translatedAs = (texts: string[], uncertain = [false, false], idxs = [0, 1]) => ({
    kind: 'translated' as const,
    lines: texts.map((text, index) => ({
      idx: idxs[index] ?? index,
      text,
      uncertain: uncertain[index] ?? false,
    })),
  })
  const translated = translatedAs(translatedLines)
  const [first, second] = transcription.lines as [Line, Line]

  it.each<[string, Partial<Transcription>, ReturnType<typeof readableText>]>([
    ['nothing from the server', {}, null],
    ['an unchanged spelling', { normalizedLines: same }, null],
    ['an empty translation', { normalizedLines: same, translatedLines: [] }, null],
    ['a modernized spelling', { normalizedLines }, normalized],
    [
      'an empty translation over a modernized spelling',
      { normalizedLines, translatedLines: [] },
      normalized,
    ],
    ['a translation over a modernized spelling', { normalizedLines, translatedLines }, translated],
    [
      'a translation over an unchanged spelling',
      { normalizedLines: same, translatedLines },
      translated,
    ],
    ['a translation alone', { translatedLines }, translated],
    [
      'a translation numbered like its source lines',
      {
        translatedLines,
        lines: [
          { ...first, idx: 4 },
          { ...second, idx: 5 },
        ],
      },
      translatedAs(translatedLines, [false, false], [4, 5]),
    ],
    [
      'a modernized spelling with expansions',
      { normalizedLines, expansions },
      { ...normalized, expansions },
    ],
    ['a translation with expansions', { normalizedLines, translatedLines, expansions }, translated],
    [
      'a translation with a blank line',
      { translatedLines: ['Іван Петрович', ''] },
      translatedAs(['Іван Петрович', '']),
    ],
    ['a shorter translation', { normalizedLines, translatedLines: ['Іван Петрович'] }, normalized],
    [
      'a longer translation',
      { normalizedLines, translatedLines: [...translatedLines, 'зайве'] },
      normalized,
    ],
    ['a blank translation', { normalizedLines, translatedLines: ['', '  '] }, normalized],
    [
      'a blank translation over an unchanged spelling',
      { normalizedLines: same, translatedLines: ['', ' '] },
      null,
    ],
    [
      'a translation of a line read uncertainly as a whole',
      { translatedLines, lines: [first, { ...second, uncertain: true }] },
      translatedAs(translatedLines, [false, true]),
    ],
    [
      'a translation of a line with an uncertain word',
      {
        translatedLines,
        lines: [
          first,
          {
            ...second,
            words: [
              { text: 'Іоаннъ', uncertain: false },
              { text: 'Петровъ', uncertain: true },
            ],
          },
        ],
      },
      translatedAs(translatedLines, [false, true]),
    ],
    [
      'a translation of a line flagged as a whole whose words are all certain',
      {
        translatedLines,
        lines: [first, { ...second, uncertain: true, words: words(second.text) }],
      },
      translated,
    ],
  ])('picks the text under the lines for %s', (_, extra, shown) => {
    expect(readableText({ ...transcription, ...extra })).toEqual(shown)
  })
})

import type { Line } from '@khronist/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  OldLettersBar,
  PageStatusBadge,
  TranscriptionLine,
  TranscriptionLineInput,
} from '../src/index.ts'

const line: Line = {
  idx: 1,
  text: 'Коваленко и законная жена его',
  box: { x: 0, y: 0.5, w: 1, h: 0.5 },
  boxSource: 'estimated',
  uncertain: false,
  words: [],
}

describe('OldLettersBar', () => {
  it('offers the eight letters of the Figma bar as buttons that name what they insert', () => {
    const html = renderToStaticMarkup(<OldLettersBar onInsert={() => undefined} />)

    const letters = [...html.matchAll(/aria-label="Вставити (.)"/gu)].map((match) => match[1])
    expect(letters).toEqual(['ѣ', 'і', 'ъ', 'ѳ', 'ѵ', 'ѡ', 'ѧ', 'ѹ'])
    expect(html).toContain('role="group"')
    expect(html.match(/<button type="button"/g)).toHaveLength(8)
  })
})

describe('PageStatusBadge', () => {
  it.each([
    ['draft', 'чернетка моделі', 'border-rule text-ink-muted'],
    ['editing', 'ви редагуєте', 'border-primary text-primary'],
    ['verified', 'підтверджено', 'border-success text-success'],
    ['disputed', 'спірне', 'border-warning text-warning'],
  ] as const)('draws the %s status in its own color', (status, label, tone) => {
    const html = renderToStaticMarkup(<PageStatusBadge status={status}>{label}</PageStatusBadge>)

    expect(html).toContain(tone)
    expect(html).toContain(label)
  })
})

describe('TranscriptionLine states', () => {
  it('is plain text until the screen lets the reader edit it', () => {
    expect(renderToStaticMarkup(<TranscriptionLine line={line} />)).not.toContain('<button')

    const editable = renderToStaticMarkup(
      <TranscriptionLine line={line} onEdit={() => undefined} />,
    )
    expect(editable).toMatch(/^<li[^>]*><button type="button"/)
  })

  it('marks a changed line with a dot for the eye and a word for screen readers', () => {
    const plain = renderToStaticMarkup(<TranscriptionLine line={line} />)
    const changed = renderToStaticMarkup(<TranscriptionLine line={line} changed />)

    expect(plain).not.toContain('bg-primary')
    expect(plain).not.toContain('pl-3.5')
    expect(changed).toContain('rounded-full bg-primary')
    expect(changed).toContain('pl-3.5')
    expect(changed).toContain('<span class="sr-only"> (виправлено)</span>')
  })

  it('highlights on hover only a line that can be opened', () => {
    expect(renderToStaticMarkup(<TranscriptionLine line={line} />)).not.toContain('hover:')
    expect(
      renderToStaticMarkup(<TranscriptionLine line={line} onEdit={() => undefined} />),
    ).toContain('hover:bg-base-300')
  })
})

describe('TranscriptionLineInput', () => {
  it('edits the line in a framed field named after its number and limited like the API', () => {
    const html = renderToStaticMarkup(
      <TranscriptionLineInput idx={1} value={line.text} onChange={() => undefined} />,
    )

    expect(html).toContain('>02</span>')
    expect(html).toContain('aria-label="Рядок 2"')
    expect(html).toContain('maxLength="500"')
    expect(html).toContain('border-base-content')
    expect(html).toContain(`>${line.text}</textarea>`)
  })
})

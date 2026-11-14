import type { Line } from '@khronist/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SectionLabel, StatusBar, strings, TranscriptionLine } from '../src/index.ts'

const line: Line = {
  idx: 1,
  text: 'Коваленко и законная жена его',
  box: { x: 0, y: 0.5, w: 1, h: 0.5 },
  boxSource: 'estimated',
  uncertain: true,
  words: [
    { text: 'Коваленко', uncertain: false },
    { text: 'и', uncertain: false },
    { text: 'законная', uncertain: true },
  ],
}

describe('TranscriptionLine', () => {
  it('numbers the line from one and underlines only the uncertain words', () => {
    const html = renderToStaticMarkup(<TranscriptionLine line={line} />)

    expect(html).toContain('>02</span>')
    expect(html).toContain(
      'Коваленко и <span class="text-warning underline" title="Модель не впевнена в цьому слові">законная</span>',
    )
  })

  it('underlines the whole line when the model gave no words', () => {
    const html = renderToStaticMarkup(<TranscriptionLine line={{ ...line, words: [] }} />)

    expect(html).toContain(
      'title="Модель не впевнена в цьому слові">Коваленко и законная жена его</span>',
    )
  })
})

describe('SectionLabel and StatusBar', () => {
  it('renders the section name in upper case and one action in the status bar', () => {
    expect(renderToStaticMarkup(<SectionLabel>Що допомагає</SectionLabel>)).toContain('uppercase')

    const bar = renderToStaticMarkup(
      <StatusBar
        type="warning"
        message="Зображення завелике"
        action="Виділити знову"
        onAction={() => undefined}
      />,
    )
    expect(bar).toContain('text-warning')
    expect(bar.match(/<button/g)).toHaveLength(1)
  })
})

describe('strings', () => {
  it('declines the number of lines in Ukrainian', () => {
    expect(strings.read.transcriptionLines(1)).toBe('Транскрипція · 1 рядок')
    expect(strings.read.transcriptionLines(3)).toBe('Транскрипція · 3 рядки')
    expect(strings.read.transcriptionLines(5)).toBe('Транскрипція · 5 рядків')
    expect(strings.read.transcriptionLines(21)).toBe('Транскрипція · 21 рядок')
  })

  it('groups pixel sizes like the Figma caption', () => {
    expect(strings.read.fragment(1240, 420)).toBe('фрагмент скану · 1 240 × 420 px')
  })
})

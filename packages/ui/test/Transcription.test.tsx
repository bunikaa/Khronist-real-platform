import type { Line } from '@khronist/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  hasUncertainMark,
  SectionLabel,
  StatusBar,
  strings,
  TranscriptionLine,
  TranslatedLine,
} from '../src/index.ts'

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
  it('numbers the line from one and marks only the uncertain words with a dotted line', () => {
    const html = renderToStaticMarkup(<TranscriptionLine line={line} />)

    expect(html).toContain('>02</span>')
    expect(html).toContain(
      'Коваленко и <span class="underline decoration-warning decoration-dotted decoration-2 underline-offset-2" title="Модель не впевнена в цьому слові">законная<span class="sr-only select-none"> (непевно)</span></span>',
    )
    expect(html).not.toContain('text-warning')
  })

  it('underlines the whole line when the model gave no words', () => {
    const html = renderToStaticMarkup(<TranscriptionLine line={{ ...line, words: [] }} />)

    expect(html).toContain(
      'title="Модель не впевнена в цьому слові">Коваленко и законная жена его<span class="sr-only select-none">',
    )
  })
})

describe('hasUncertainMark', () => {
  const certain = line.words.map((word) => ({ ...word, uncertain: false }))

  it.each([
    ['an uncertain word', line, true],
    ['only certain words on a line flagged as a whole', { ...line, words: certain }, false],
    ['no words on a line flagged as a whole', { ...line, words: [] }, true],
    ['no words on a certain line', { ...line, uncertain: false, words: [] }, false],
  ])('finds a mark for %s: %s', (_, checked, marked) => {
    expect(hasUncertainMark(checked)).toBe(marked)
  })
})

describe('TranslatedLine', () => {
  const dotted =
    'class="underline decoration-warning decoration-dotted decoration-2 underline-offset-2"'

  it('numbers the line like the source line and leaves a certain line plain', () => {
    const html = renderToStaticMarkup(
      <TranslatedLine idx={1} text="Коваленко і законна дружина" uncertain={false} />,
    )

    expect(html).toContain('>02</span>')
    expect(html).toContain('Коваленко і законна дружина')
    expect(html).not.toContain('decoration-dotted')
  })

  it('underlines the whole line whose source has uncertain words and says why', () => {
    const html = renderToStaticMarkup(
      <TranslatedLine idx={1} text="Коваленко і законна дружина" uncertain />,
    )

    expect(html).toContain(
      `<span ${dotted} title="В оригіналі цього рядка є непевні слова">Коваленко і законна дружина<span class="sr-only select-none"> (непевний рядок)</span></span>`,
    )
  })

  it.each([false, true])('keeps a blank line one line high (uncertain: %s)', (uncertain) => {
    const html = renderToStaticMarkup(<TranslatedLine idx={0} text=" " uncertain={uncertain} />)

    expect(html).toContain('>01</span>')
    expect(html).toContain('\u00a0')
    expect(html).not.toContain('decoration-dotted')
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

  it('names the shortcut only when Chrome assigned one', () => {
    expect(strings.read.promptBody('Alt+Shift+X')).toContain('Alt + Shift + X')
    expect(strings.read.promptBody(undefined)).toBe(
      'Натисніть кнопку нижче, потім обведіть запис на аркуші.',
    )
  })

  it('groups pixel sizes like the Figma caption', () => {
    expect(strings.read.fragment(1240, 420)).toBe('фрагмент скану · 1\u00a0240 × 420 px')
  })
})

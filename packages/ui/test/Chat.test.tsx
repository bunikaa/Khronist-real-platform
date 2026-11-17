import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  ChatComposer,
  ChatMessage,
  SourceRef,
  strings,
  Switch,
  Tab,
  TextField,
} from '../src/index.ts'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '')

const composer = (value: string, busy: boolean, followups: string[] = []) =>
  renderToStaticMarkup(
    <ChatComposer
      inputRef={{ current: null }}
      value={value}
      placeholder="Запитати про цей аркуш…"
      busy={busy}
      followups={followups}
      onChange={() => {}}
      onSend={() => {}}
      onFollowup={() => {}}
    />,
  )

describe('ChatMessage', () => {
  it('shows a question as a bubble without the author', () => {
    const html = renderToStaticMarkup(<ChatMessage kind="user">Де зараз це село?</ChatMessage>)

    expect(textOf(html)).toBe('Де зараз це село?')
    expect(html).toContain('bg-base-200')
  })

  it.each([
    [false, 'ХроністВідповідь [1].[1]Назва'],
    [true, 'ХроністДжерела відповідають лише частково — перевірте за нимиВідповідь [1].[1]Назва'],
  ])('shows an answer with its sources, uncertain: %s', (uncertain, text) => {
    const html = renderToStaticMarkup(
      <ChatMessage
        kind="answer"
        uncertain={uncertain}
        sources={[<SourceRef key={1} number={1} title="Назва" note="" />]}
      >
        Відповідь [1].
      </ChatMessage>,
    )

    expect(textOf(html)).toBe(text)
    expect(html).toContain('<ol aria-label="Джерела"')
  })

  it('shows no empty source list for an answer without citations', () => {
    const html = renderToStaticMarkup(
      <ChatMessage kind="answer" uncertain={false} sources={[]}>
        Відповідь.
      </ChatMessage>,
    )

    expect(textOf(html)).toBe('ХроністВідповідь.')
    expect(html).not.toContain('<ol')
  })

  it('shows the unknown answer muted, with no sources and no extra action', () => {
    const html = renderToStaticMarkup(
      <ChatMessage kind="unknown">{strings.chat.unknown(false)}</ChatMessage>,
    )

    expect(textOf(html)).toBe('ХроністУ довідковому корпусі немає відповіді на це запитання.')
    expect(html).toContain('text-ink-muted')
    expect(html).not.toContain('<ol')
    expect(html).not.toContain('<button')
  })
})

describe('SourceRef', () => {
  it('links the title to the source and opens it in a new tab', () => {
    const html = renderToStaticMarkup(
      <SourceRef
        number={2}
        title="Восприемники"
        href="https://example.org/a"
        note="переказ статті · CC BY-SA 4.0"
      />,
    )

    expect(textOf(html)).toBe('[2]Восприемникипереказ статті · CC BY-SA 4.0')
    expect(html).toContain('href="https://example.org/a" target="_blank" rel="noreferrer"')
  })

  it('shows the title as text without a link', () => {
    const html = renderToStaticMarkup(<SourceRef number={1} title="«Села»" note="з транскрипції" />)

    expect(html).not.toContain('<a')
  })
})

describe('ChatComposer', () => {
  it.each([
    ['', false, true],
    ['   ', false, true],
    ['Що?', true, true],
    ['Що?', false, false],
  ])('send with «%s», busy %s, disabled %s', (value, busy, disabled) => {
    const html = composer(value, busy)

    expect(html.includes('aria-label="Надіслати" disabled=""')).toBe(disabled)
  })

  it('frames and focuses the question field like a text field', () => {
    const frame = composer('', false).match(/<div class="([^"]+)"><input/)?.[1] ?? ''
    const field = renderToStaticMarkup(<TextField label="Код" />).match(
      /<input[^>]*class="([^"]+)"/,
    )?.[1]
    const focus = [
      'rounded-field',
      'border-rule',
      'focus-within:border-base-content',
      'focus-within:ring-[0.5px]',
      'focus-within:ring-base-content',
      'focus-within:ring-inset',
    ]

    for (const name of focus) {
      expect(frame.split(' ')).toContain(name)
      expect(field?.split(' ')).toContain(name)
    }
  })

  it('limits the question to the contract length', () => {
    expect(composer('', false)).toContain('maxLength="2000"')
  })

  it('shows follow-ups as buttons only when there are any', () => {
    expect(composer('', false)).not.toContain('Можна спитати далі')
    const html = composer('', false, ['Хто такі куми?'])

    expect(html).toContain('<ul aria-label="Можна спитати далі"')
    expect(html).toMatch(/<button type="button"[^>]*>Хто такі куми\?<\/button>/)
  })
})

describe('Tab and Switch', () => {
  it.each([
    ['active', 'true', '0', 'bg-primary'],
    ['inactive', 'false', '-1', 'text-ink-muted'],
  ] as const)('marks the %s tab', (state, selected, tabIndex, className) => {
    const html = renderToStaticMarkup(
      <Tab id="tab-ask" controls="panel" state={state} onSelect={() => {}}>
        Спитати
      </Tab>,
    )

    expect(html).toContain(
      `role="tab" id="tab-ask" aria-controls="panel" aria-selected="${selected}" tabindex="${tabIndex}"`,
    )
    expect(html).toContain(className)
    expect(html).not.toContain('disabled=""')
  })

  it('locks a disabled tab', () => {
    const html = renderToStaticMarkup(
      <Tab id="tab-ask" controls="panel" state="inactive" disabled onSelect={() => {}}>
        Спитати
      </Tab>,
    )

    expect(html).toContain('disabled=""')
  })

  it.each([true, false])('reports the switch state %s', (checked) => {
    const html = renderToStaticMarkup(
      <Switch checked={checked} label="Контекст" onChange={() => {}} />,
    )

    expect(html).toContain(`role="switch" aria-checked="${checked}" aria-label="Контекст"`)
  })
})

describe('chat texts', () => {
  it.each([
    ['арк. 14', 3, 'Контекст: арк. 14, 3 рядки прочитано'],
    ['зобр. 4', 1, 'Контекст: зобр. 4, 1 рядок прочитано'],
    [undefined, 5, 'Контекст: 5 рядків прочитано'],
  ])('names the context %s with %i lines', (page, count, text) => {
    expect(strings.chat.context(page, count)).toBe(text)
  })

  it('calls a corpus source a retelling and shows its licence', () => {
    expect(strings.chat.chunkSource('CC BY-SA 4.0', true)).toBe('переказ статті · CC BY-SA 4.0')
    expect(strings.chat.chunkSource('CC BY-SA 4.0', false)).toBe('CC BY-SA 4.0')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ExplainSheet, FactPair } from '../src/index.ts'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '')

describe('FactPair', () => {
  it('shows two facts side by side with a label, an optional note and a value', () => {
    const html = renderToStaticMarkup(
      <FactPair
        facts={[
          { label: 'Дата', note: '12 січня 1884, ст. ст.', value: '24 січня 1884, н. ст.' },
          { label: 'День тижня', value: 'четвер' },
        ]}
      />,
    )

    expect(html).toMatch(/^<dl class="grid grid-cols-2 divide-x divide-rule">/)
    expect(html.match(/<dt /g)).toHaveLength(2)
    expect(html).toContain('<dd class="text-body-12 text-ink-muted">12 січня 1884, ст. ст.</dd>')
    expect(html).toContain('<dd class="text-label-13">24 січня 1884, н. ст.</dd>')
    expect(html.match(/<dd /g)).toHaveLength(3)
    expect(textOf(html)).toBe('Дата12 січня 1884, ст. ст.24 січня 1884, н. ст.День тижнячетвер')
  })
})

describe('ExplainSheet', () => {
  const render = () =>
    renderToStaticMarkup(
      <ExplainSheet
        label="Пояснення терміна"
        title="крестьянинъ"
        closeLabel="Закрити"
        onClose={() => undefined}
      >
        <p>Селянин.</p>
      </ExplainSheet>,
    )

  it('is a bottom sheet over a scrim, named by the explained word', () => {
    const html = render()

    expect(html).toMatch(/^<dialog aria-labelledby="([^"]+)" class="[^"]*bottom-0[^"]*">/)
    expect(html).toContain('backdrop:bg-base-content/20')
    expect(html).toContain(
      '<div aria-live="polite" class="flex flex-col gap-2"><p>Селянин.</p></div>',
    )
    const [, titleId] = html.match(/aria-labelledby="([^"]+)"/) ?? []
    expect(html).toContain(
      `<h2 id="${titleId}" class="text-heading-20 break-words">крестьянинъ</h2>`,
    )
    expect(html).toContain('>Пояснення терміна</p>')
    expect(html).toContain('<p>Селянин.</p>')
  })

  it('shows an alert outside the live region, so a status bar is announced once', () => {
    const html = renderToStaticMarkup(
      <ExplainSheet
        label="Пояснення терміна"
        title="крестьянинъ"
        closeLabel="Закрити"
        alert={<div role="status">Пояснення тимчасово недоступне</div>}
        onClose={() => undefined}
      >
        {null}
      </ExplainSheet>,
    )

    expect(html).toContain('<div aria-live="polite" class="flex flex-col gap-2"></div>')
    expect(html).toContain('<div role="status">Пояснення тимчасово недоступне</div>')
  })

  it('closes with one ghost button and offers nothing else', () => {
    const html = render()

    expect(html.match(/<button/g)).toHaveLength(1)
    expect(html).toContain('btn-ghost')
    expect(html).toContain('>Закрити</button>')
    expect(html).not.toContain('нотатник')
  })
})

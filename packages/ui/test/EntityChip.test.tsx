import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EntityChip } from '../src/index.ts'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '')

describe('EntityChip', () => {
  it.each([
    ['person', 'Особа: Іоаннъ Коваленко'],
    ['place', 'Місце: Іоаннъ Коваленко'],
    ['term', 'Термін: Іоаннъ Коваленко'],
    ['date', 'Дата: Іоаннъ Коваленко'],
  ] as const)('reads the %s type before the name, as Figma shows no type', (type, read) => {
    const html = renderToStaticMarkup(<EntityChip type={type}>Іоаннъ Коваленко</EntityChip>)

    expect(textOf(html)).toBe(read)
    expect(html).toMatch(
      /<span class="sr-only">[^<]+: <\/span><span class="truncate">Іоаннъ Коваленко<\/span>/,
    )
    expect(html).not.toContain('aria-hidden')
    expect(html).not.toContain('<button')
  })

  it('shows the full name on hover when it is cut', () => {
    const html = renderToStaticMarkup(<EntityChip type="place">Михайлівська Борщагівка</EntityChip>)

    expect(html).toContain('title="Михайлівська Борщагівка"')
  })

  it('marks the active state differently from the default one', () => {
    const plain = renderToStaticMarkup(<EntityChip type="place">Борщагівка</EntityChip>)
    const active = renderToStaticMarkup(
      <EntityChip type="place" state="active">
        Борщагівка
      </EntityChip>,
    )

    expect(plain).toContain('border-rule')
    expect(plain).not.toContain('border-primary')
    expect(active).toContain('border-primary')
    expect(active).toContain('bg-accent-soft')
  })

  it('becomes a button that opens a sheet only when it can be selected', () => {
    const closed = renderToStaticMarkup(
      <EntityChip type="term" onSelect={() => undefined}>
        крестьянинъ
      </EntityChip>,
    )
    const open = renderToStaticMarkup(
      <EntityChip type="term" state="active" onSelect={() => undefined}>
        крестьянинъ
      </EntityChip>,
    )

    expect(closed).toMatch(/^<button type="button" title="крестьянинъ" aria-haspopup="dialog"/)
    expect(closed).toContain('aria-expanded="false"')
    expect(open).toContain('aria-expanded="true"')
    expect(open).toContain('border-primary')
    expect(textOf(closed)).toBe('Термін: крестьянинъ')
  })
})

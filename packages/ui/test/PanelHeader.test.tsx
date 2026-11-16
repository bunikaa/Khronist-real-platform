import type { Shelfmark } from '@khronist/contracts'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelHeader } from '../src/index.ts'

const shelfmark: Shelfmark = {
  archive: 'ЦДІАК України',
  fond: '127',
  opys: '1078',
  sprava: '177',
  image: 4,
}

describe('PanelHeader', () => {
  it('shows only the brand when no scan is open', () => {
    const html = renderToStaticMarkup(<PanelHeader />)

    expect(html).toContain('>Хроніст</span>')
    expect(html.match(/<span/g)).toHaveLength(1)
  })

  it('shows the shelfmark and keeps the image number out of the truncated part', () => {
    const html = renderToStaticMarkup(<PanelHeader shelfmark={shelfmark} />)

    expect(html).toContain(
      '<span class="truncate">ЦДІАК України · ф. 127, оп. 1078, спр. 177 ·</span>',
    )
    expect(html).toContain('<span class="shrink-0">зобр. 4</span>')
  })

  it('shows the account button with its label and whether its screen is open', () => {
    const closed = renderToStaticMarkup(
      <PanelHeader account={{ label: 'Увійти', open: false, onToggle: () => {} }} />,
    )
    const open = renderToStaticMarkup(
      <PanelHeader account={{ label: 'Профіль', open: true, onToggle: () => {} }} />,
    )

    expect(closed).toContain('aria-label="Увійти"')
    expect(closed).toContain('aria-pressed="false"')
    expect(open).toContain('aria-label="Профіль"')
    expect(open).toContain('aria-pressed="true"')
  })

  it('prefers the folio over the image number', () => {
    const html = renderToStaticMarkup(<PanelHeader shelfmark={{ ...shelfmark, folio: '14' }} />)

    expect(html).toContain('<span class="shrink-0">арк. 14</span>')
  })
})

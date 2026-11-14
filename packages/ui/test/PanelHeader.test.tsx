import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PanelHeader } from '../src/index.ts'

describe('PanelHeader', () => {
  it('shows only the brand until the shelfmark and the user menu exist', () => {
    const html = renderToStaticMarkup(<PanelHeader />)

    expect(html).toContain('<header')
    expect(html).toContain('>Хроніст</span>')
    expect(html.match(/<span/g)).toHaveLength(1)
  })
})

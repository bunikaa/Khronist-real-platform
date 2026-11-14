import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionBar, Button } from '../src/index.ts'
import { rectBetween } from '../src/SelectionOverlay.tsx'

describe('rectBetween', () => {
  it('builds the same rectangle whichever way the pointer was dragged', () => {
    const expected = { left: 10, top: 20, width: 90, height: 40 }

    expect(rectBetween({ x: 10, y: 20 }, { x: 100, y: 60 })).toEqual(expected)
    expect(rectBetween({ x: 100, y: 60 }, { x: 10, y: 20 })).toEqual(expected)
  })
})

describe('ActionBar', () => {
  it('lays the actions out in a 48 px bar with a rule on top', () => {
    const html = renderToStaticMarkup(
      <ActionBar>
        <Button>Виділити фрагмент</Button>
      </ActionBar>,
    )

    expect(html).toContain('h-12')
    expect(html).toContain('border-t border-rule')
    expect(html).toContain('>Виділити фрагмент</button>')
  })
})

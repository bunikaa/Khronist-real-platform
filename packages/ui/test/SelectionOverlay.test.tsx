import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ActionBar, Button } from '../src/index.ts'
import { isLargeEnough, rectBetween } from '../src/SelectionOverlay.tsx'

describe('rectBetween', () => {
  it('builds the same rectangle whichever way the pointer was dragged', () => {
    const expected = { left: 10, top: 20, width: 90, height: 40 }

    expect(rectBetween({ x: 10, y: 20 }, { x: 100, y: 60 })).toEqual(expected)
    expect(rectBetween({ x: 100, y: 60 }, { x: 10, y: 20 })).toEqual(expected)
  })
})

describe('isLargeEnough', () => {
  it('refuses a selection smaller than 24 px on either side, such as a shaky click', () => {
    expect(isLargeEnough({ left: 0, top: 0, width: 2, height: 2 })).toBe(false)
    expect(isLargeEnough({ left: 0, top: 0, width: 300, height: 23 })).toBe(false)
    expect(isLargeEnough({ left: 0, top: 0, width: 24, height: 24 })).toBe(true)
  })
})

describe('ActionBar', () => {
  it('lays the actions out in a 48 px bar with a rule on top, wrapping on a narrow panel', () => {
    const html = renderToStaticMarkup(
      <ActionBar>
        <Button>Виділити фрагмент</Button>
      </ActionBar>,
    )

    expect(html).toContain('min-h-12')
    expect(html).toContain('flex-wrap')
    expect(html).toContain('py-2')
    expect(html).toContain('border-t border-rule')
    expect(html).toContain('>Виділити фрагмент</button>')
  })
})

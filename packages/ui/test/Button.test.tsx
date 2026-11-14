import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Button } from '../src/index.ts'

describe('Button', () => {
  it('is a primary small button that does not submit forms by default', () => {
    const html = renderToStaticMarkup(<Button>Прочитати</Button>)

    expect(html).toContain('type="button"')
    expect(html).toContain('btn-primary')
    expect(html).toContain('btn-sm')
    expect(html).toContain('>Прочитати</button>')
  })

  it('maps the Figma kinds and sizes to daisyUI classes', () => {
    const outline = renderToStaticMarkup(
      <Button kind="outline" size="md">
        Скасувати
      </Button>,
    )
    const ghost = renderToStaticMarkup(<Button kind="ghost">Ще</Button>)

    expect(outline).toContain('btn-outline')
    expect(outline).toContain('h-9')
    expect(outline).not.toContain('btn-sm')
    expect(ghost).toContain('btn-ghost')
  })

  it('passes native attributes through', () => {
    const html = renderToStaticMarkup(
      <Button type="submit" disabled>
        Надіслати
      </Button>,
    )

    expect(html).toContain('type="submit"')
    expect(html).toContain('disabled')
  })
})

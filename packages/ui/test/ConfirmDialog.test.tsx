import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConfirmDialog } from '../src/index.ts'

const render = (props: { dontAsk?: boolean; busy?: boolean } = {}) =>
  renderToStaticMarkup(
    <ConfirmDialog
      title="Підтвердити 3 рядки як прочитані вами?"
      body="Текст стане публічним під CC BY 4.0 з підписом «Олена К.»."
      confirmLabel="Підтвердити"
      cancelLabel="Скасувати"
      dontAskLabel="Більше не питати"
      dontAsk={props.dontAsk ?? false}
      busy={props.busy}
      onDontAskChange={() => undefined}
      onConfirm={() => undefined}
      onCancel={() => undefined}
    />,
  )

describe('ConfirmDialog', () => {
  it('is a card inside the panel, not a modal, with a question, the licence, a checkbox and two actions', () => {
    const html = render()

    expect(html).toContain('role="group"')
    expect(html).not.toContain('role="dialog"')
    expect(html).toMatch(
      /<h2 id="([^"]+)" class="text-heading-16">Підтвердити 3 рядки як прочитані вами\?<\/h2>/,
    )
    expect(html).toContain('aria-labelledby=')
    expect(html).toContain('Текст стане публічним під CC BY 4.0 з підписом «Олена К.».')
    expect(html).toContain('rounded-md border border-rule bg-base-200 p-4')
    expect(html).toMatch(/<input type="checkbox" class="checkbox[^"]*"/)
    expect(html).toContain('Більше не питати')
    expect(html).toContain('btn-primary')
    expect(html).toContain('>Підтвердити</button>')
    expect(html).toContain('btn-ghost')
    expect(html).toContain('>Скасувати</button>')
  })

  it('shows the toggle state and locks every control while confirming', () => {
    expect(render({ dontAsk: true })).toContain('checked=""')
    expect(render()).not.toContain('checked=""')
    expect(render({ busy: true }).match(/disabled=""/g)).toHaveLength(3)
  })
})

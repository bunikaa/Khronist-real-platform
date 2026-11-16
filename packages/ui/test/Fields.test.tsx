import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SettingsRow, TextField } from '../src/index.ts'

describe('TextField', () => {
  it('ties the label to the input', () => {
    const html = renderToStaticMarkup(<TextField label="Електронна пошта" name="email" />)

    const id = html.match(/<input[^>]*\sid="([^"]+)"/)?.[1]
    expect(id).toBeDefined()
    expect(html).toContain(`for="${id}"`)
    expect(html).toContain('Електронна пошта')
  })

  it('marks an invalid value for the eye and for screen readers', () => {
    const valid = renderToStaticMarkup(<TextField label="Код" />)
    const invalid = renderToStaticMarkup(<TextField label="Код" invalid />)

    expect(valid).toContain('aria-invalid="false"')
    expect(invalid).toContain('aria-invalid="true"')
    expect(invalid).toContain('border-error')
  })
})

describe('SettingsRow', () => {
  it('is a button with a chevron that cuts a long value instead of the label', () => {
    const html = renderToStaticMarkup(
      <SettingsRow label="Гаряча клавіша" value="Alt + Shift + X" onSelect={() => {}} />,
    )

    expect(html).toMatch(/^<button/)
    expect(html).toContain('lucide-chevron-right')
    expect(html).toContain('<span class="shrink-0 text-base-content">Гаряча клавіша</span>')
    expect(html).toContain('class="min-w-0 flex-1 truncate text-right text-ink-muted"')
  })
})

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { Checkbox, FieldError, SettingsRow, TextField } from '../src/index.ts'

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

describe('Checkbox', () => {
  it('is a checkbox inside its label, so the text toggles it too', () => {
    const html = renderToStaticMarkup(<Checkbox label="Лише підтверджені" checked readOnly />)

    expect(html).toMatch(/^<label class="flex cursor-pointer items-center gap-2 text-body-13">/)
    expect(html).toMatch(/<input type="checkbox" class="checkbox[^"]*"[^>]* checked=""/)
    expect(html).toMatch(/Лише підтверджені<\/label>$/)
  })
})

describe('FieldError', () => {
  it('is a short error text an input can point to', () => {
    expect(renderToStaticMarkup(<FieldError id="years">Рік від 1000 до 2100</FieldError>)).toBe(
      '<p id="years" class="text-body-12 text-error">Рік від 1000 до 2100</p>',
    )
  })
})

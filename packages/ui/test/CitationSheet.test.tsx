import type { ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { CitationSheet, StatusBar } from '../src/index.ts'

const citation = 'ЦДІАК України. Ф. 127. Оп. 1078. Спр. 177. Арк. 14зв.\nСела Борщаговки'

const render = (props: Partial<ComponentProps<typeof CitationSheet>> = {}) =>
  renderToStaticMarkup(
    <CitationSheet
      format="dstu"
      withTranscription
      onFormatChange={() => undefined}
      onWithTranscriptionChange={() => undefined}
      onCopy={() => undefined}
      onClose={() => undefined}
      {...props}
    />,
  )

const radios = (html: string) =>
  [...html.matchAll(/<label[^>]*><input type="radio"([^>]*)\/>([^<]+)<\/label>/g)].map(
    ([, attributes, label]) => ({
      label,
      checked: attributes?.includes('checked=""'),
      disabled: attributes?.includes('disabled=""'),
    }),
  )

const bar = (message: string) => (
  <StatusBar
    type="warning"
    message={message}
    action="Спробувати ще раз"
    onAction={() => undefined}
  />
)

describe('CitationSheet', () => {
  it('is a native dialog over a scrim with the three formats of Figma, the toggle and one action', () => {
    const html = render({ text: citation })

    const titleId = html.match(/<h2 id="([^"]+)"[^>]*>Цитата<\/h2>/)?.[1]
    expect(html).toMatch(new RegExp(`^<dialog aria-labelledby="${titleId}"`))
    expect(html).toContain('backdrop:bg-base-content/20')
    expect(html).toContain('role="radiogroup" aria-label="Формат цитати"')
    expect(radios(html)).toEqual([
      { label: 'ДСТУ', checked: true, disabled: false },
      { label: 'Markdown', checked: false, disabled: false },
      { label: 'Текст', checked: false, disabled: false },
    ])
    const switchId = html.match(/<button id="([^"]+)" type="button" role="switch"/)?.[1]
    expect(html).toContain('role="switch" aria-checked="true" aria-label="З транскрипцією"')
    expect(html).toMatch(new RegExp(`<label for="${switchId}"[^>]*>З транскрипцією</label>`))
    expect(html.match(/<button/g)).toHaveLength(2)
    expect(html).toContain('>Скопіювати</button>')
    expect(html).not.toContain('нотатник')
  })

  it('shows the text of the API as is, line breaks included', () => {
    const html = render({ text: citation, format: 'markdown', withTranscription: false })

    expect(html).toContain(`>${citation}</pre>`)
    expect(html).toContain('whitespace-pre-wrap')
    expect(radios(html).find(({ checked }) => checked)?.label).toBe('Markdown')
    expect(html).toContain('role="switch" aria-checked="false"')
  })

  it('says the citation is on the way and keeps the copy off until it comes', () => {
    const html = render({ loading: true })

    expect(html).toContain('Складаємо цитату…')
    expect(html).not.toContain('<pre')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Скопіювати<\/button>/)
  })

  it('confirms a copy on the button itself', () => {
    expect(render({ text: citation, copied: true })).toContain('>Скопійовано</button>')
  })

  it('shows a problem as a status bar with its one action', () => {
    const html = render({ alert: bar('Забагато запитів, спробуйте пізніше') })

    expect(html).toContain('role="status"')
    expect(html).toContain('Забагато запитів, спробуйте пізніше')
    expect(html).toContain('>Спробувати ще раз</button>')
    expect(html).not.toContain('<pre')
  })

  it('keeps the text under a failed copy, so it can be copied by hand', () => {
    const html = render({ text: citation, alert: bar('Не вдалося скопіювати') })

    expect(html).toContain(`>${citation}</pre>`)
    expect(html.indexOf('<pre')).toBeLessThan(html.indexOf('role="status"'))
  })

  it('locks the format and the toggle after a refusal', () => {
    const html = render({ locked: true, alert: bar('Не знайдено') })

    expect(radios(html).every(({ disabled }) => disabled)).toBe(true)
    expect(html).toMatch(/role="switch"[^>]*disabled=""/)
  })
})

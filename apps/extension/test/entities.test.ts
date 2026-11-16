import type { Entity } from '@khronist/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('wxt/browser', () => ({ browser: {} }))

const { distinctEntities } = await import('../entrypoints/sidepanel/result.tsx')

const entity = (type: Entity['type'], text: string, start: number): Entity => ({
  type,
  text,
  start,
  end: start + text.length,
})

const chip = (type: Entity['type'], text: string) => ({ type, text })

describe('distinctEntities', () => {
  it.each<[string, Entity[], { type: Entity['type']; text: string }[]]>([
    ['nothing for no entities', [], []],
    [
      'the order of the text, not of the answer',
      [entity('place', 'Борщагівка', 30), entity('person', 'Іоаннъ', 5)],
      [chip('person', 'Іоаннъ'), chip('place', 'Борщагівка')],
    ],
    [
      'one chip for the same name met twice',
      [entity('person', 'Іоаннъ', 5), entity('person', 'Іоаннъ', 40)],
      [chip('person', 'Іоаннъ')],
    ],
    [
      'two chips for the same text of different types',
      [entity('term', 'Марія', 5), entity('person', 'Марія', 20)],
      [chip('term', 'Марія'), chip('person', 'Марія')],
    ],
    [
      'two chips, shorter first, for names that start at one place',
      [entity('person', 'Іоаннъ Коваленко', 0), entity('person', 'Іоаннъ', 0)],
      [chip('person', 'Іоаннъ'), chip('person', 'Іоаннъ Коваленко')],
    ],
    [
      'a word split across lines joined, and one chip with the same word on one line',
      [entity('place', 'Борща-\nговки', 3), entity('place', 'Борщаговки', 50)],
      [chip('place', 'Борщаговки')],
    ],
    [
      'a name broken across lines without a hyphen as two words',
      [entity('person', 'Іоаннъ\nКоваленко', 0)],
      [chip('person', 'Іоаннъ Коваленко')],
    ],
  ])('keeps %s', (_case, entities, expected) => {
    expect(distinctEntities(entities)).toEqual(expected)
  })
})

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

describe('distinctEntities with base forms', () => {
  const date = (start: number, normalized?: string): Entity => ({
    ...entity('date', '12 генваря 1884', start),
    ...(normalized !== undefined && { normalized }),
  })
  const dateChip = (normalized?: string) => ({
    ...chip('date', '12 генваря 1884'),
    ...(normalized !== undefined && { normalized }),
  })

  it.each<[string, Entity[], ReturnType<typeof dateChip>[]]>([
    ['the base form of a single entity', [date(0, '12 января 1884')], [dateChip('12 января 1884')]],
    ['no base form when none was given', [date(0), date(40)], [dateChip()]],
    [
      'the base form of a later repeat when the first has none',
      [date(0), date(40, '12 января 1884')],
      [dateChip('12 января 1884')],
    ],
    [
      'the base form of a later repeat when the first one is blank',
      [date(0, '  '), date(40, '12 января 1884')],
      [dateChip('12 января 1884')],
    ],
    [
      'the first base form when both have one',
      [date(0, '12 января 1884'), date(40, '12-го января 1884')],
      [dateChip('12 января 1884')],
    ],
  ])('keeps %s', (_case, entities, expected) => {
    expect(distinctEntities(entities)).toEqual(expected)
  })
})

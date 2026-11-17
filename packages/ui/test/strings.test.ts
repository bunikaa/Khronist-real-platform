import { describe, expect, it } from 'vitest'
import { strings } from '../src/index.ts'

const now = new Date('2026-11-16T12:00:00.000Z')
const before = (ms: number) => new Date(now.getTime() - ms)

describe('conflict texts', () => {
  it.each([
    [[1], 'Андрій М.', 'Поки ви редагували, рядок 02 змінив(ла) Андрій М.'],
    [[1, 4], 'Андрій М.', 'Поки ви редагували, рядки 02, 05 змінив(ла) Андрій М.'],
    [[0], '', 'Поки ви редагували, рядок 01 змінили'],
  ])('names lines %j changed by «%s»', (idxs, name, text) => {
    expect(strings.edit.conflictBy(idxs, name)).toBe(text)
  })

  it.each([
    ['Андрій М.', 20_000, 'Андрій М. · щойно'],
    ['Андрій М.', 2 * 60_000 + 5_000, 'Андрій М. · 2 хв тому'],
    ['Андрій М.', 3 * 60 * 60_000, 'Андрій М. · 3 год тому'],
    ['', 2 * 24 * 60 * 60_000, 'Нова версія · 14.11.2026'],
  ])('says who wrote the other version and when (%s, %i ms ago)', (name, ago, text) => {
    expect(strings.edit.theirs(name, before(ago), now)).toBe(text)
  })
})

describe('confirmed texts', () => {
  it('names who confirmed, or says it is confirmed without a name', () => {
    expect(strings.confirm.verifiedBy('Олена К.', '12.11.2026')).toBe(
      'Цей фрагмент підтвердив(ла) Олена К. 12.11.2026',
    )
    expect(strings.confirm.verifiedBy('', '12.11.2026')).toBe(
      'Цей фрагмент підтверджено 12.11.2026',
    )
  })

  it.each([
    [1, 0, 'прочитано · 1 фрагмент'],
    [3, 1, 'прочитано · 3 фрагменти · підтверджено 1'],
    [16, 0, 'прочитано · 16 фрагментів'],
  ])('counts %i fragments, %i confirmed', (count, verified, text) => {
    expect(strings.read.alreadyRead(count, verified)).toBe(text)
  })
})

describe('explanation texts', () => {
  it.each([
    ['суспільне надбання', true, 'переказ статті · суспільне надбання'],
    ['CC BY-SA 4.0', true, 'переказ статті · CC BY-SA 4.0'],
    ['CC BY-SA 4.0', false, 'CC BY-SA 4.0'],
  ])('signs a source under %s, retold: %s', (licence, retelling, text) => {
    expect(strings.explain.source(licence, retelling)).toBe(text)
  })
})

import { describe, expect, it } from 'vitest'
import { dateExtra, describeDate, julianToGregorian, parseDate } from '../src/services/calendar.ts'

type Ymd = [number, number, number]

describe('julianToGregorian', () => {
  it.each<[string, Ymd, Ymd, string]>([
    ['the demo record of 1884', [1884, 1, 12], [1884, 1, 24], 'четвер'],
    ['the first Gregorian day', [1582, 10, 5], [1582, 10, 15], 'п’ятниця'],
    ['a day of 1700 with 10 days of difference', [1700, 2, 18], [1700, 2, 28], 'неділя'],
    ['the 18th century', [1799, 12, 31], [1800, 1, 11], 'субота'],
    ['February 28 of 1800', [1800, 2, 28], [1800, 3, 11], 'вівторок'],
    ['February 29 of 1800 with 12 days of difference', [1800, 2, 29], [1800, 3, 12], 'середа'],
    ['the last day of 1899', [1899, 12, 31], [1900, 1, 12], 'п’ятниця'],
    ['February 28 of 1900', [1900, 2, 28], [1900, 3, 12], 'понеділок'],
    ['February 29 of 1900 with 13 days of difference', [1900, 2, 29], [1900, 3, 13], 'вівторок'],
    ['March 1 of 1900', [1900, 3, 1], [1900, 3, 14], 'середа'],
    ['October 25 of 1917', [1917, 10, 25], [1917, 11, 7], 'середа'],
    ['the last Julian day in the Russian Empire', [1918, 1, 31], [1918, 2, 13], 'середа'],
  ])('converts %s', (_case, [year, month, day], [gYear, gMonth, gDay], weekday) => {
    expect(julianToGregorian({ year, month, day })).toEqual({
      date: { year: gYear, month: gMonth, day: gDay },
      weekday,
    })
  })

  it.each([
    ['February 29 of a common year', { year: 1885, month: 2, day: 29 }],
    ['June 31', { year: 1884, month: 6, day: 31 }],
    ['a month out of range', { year: 1884, month: 13, day: 1 }],
    ['a day zero', { year: 1884, month: 1, day: 0 }],
    ['a day before the Gregorian calendar existed', { year: 1582, month: 10, day: 4 }],
    ['a day after the Russian Empire left the Julian calendar', { year: 1918, month: 2, day: 1 }],
  ])('refuses %s', (_case, date) => {
    expect(julianToGregorian(date)).toBeNull()
  })
})

describe('parseDate', () => {
  it.each([
    ['12 генваря 1884', [1884, 1, 12]],
    ['12 января 1884 г.', [1884, 1, 12]],
    ['12 Генв. 1884', [1884, 1, 12]],
    ['1-го марта 1900 года', [1900, 3, 1]],
    ['1-ГО марта 1900', [1900, 3, 1]],
    ['1-е марта 1900', [1900, 3, 1]],
    ['29 Февраля 1900', [1900, 2, 29]],
    ['3 Ѳевраля 1884', [1884, 2, 3]],
    ['12 апрѣля 1884', [1884, 4, 12]],
    ['5 мая 1884', [1884, 5, 5]],
    ['8 іюня 1872', [1872, 6, 8]],
    ['8 Iюля 1872', [1872, 7, 8]],
    ['5 сентября\n1881', [1881, 9, 5]],
    ['3 дек. 1859', [1859, 12, 3]],
    ['3 числа 1884 года, 12 января 1884', [1884, 1, 12]],
  ])('reads %j', (text, [year, month, day]) => {
    expect(parseDate(text)).toEqual({ year, month, day })
  })

  it.each([
    ['в 1884 году'],
    ['генваря 1884'],
    ['12 генваря'],
    ['12 марта 84'],
    ['112 января 1884'],
    ['12 января 18845'],
    ['5 майора 1884'],
    ['Борщаговка'],
  ])('does not guess a full date from %j', (text) => {
    expect(parseDate(text)).toBeNull()
  })
})

describe('dateExtra', () => {
  it('stores the new style date as ISO and the weekday', () => {
    expect(dateExtra('12 января 1884')).toEqual({ newStyle: '1884-01-24', weekday: 'четвер' })
  })

  it.each([['в 1884 году'], ['31 іюня 1884'], ['5 марта 1925']])(
    'stores nothing for %j',
    (text) => {
      expect(dateExtra(text)).toBeUndefined()
    },
  )
})

describe('describeDate', () => {
  it('names both dates and the weekday in Ukrainian', () => {
    expect(describeDate('12 генваря 1884')).toEqual({
      julian: '12 січня 1884',
      gregorian: '24 січня 1884',
      weekday: 'четвер',
    })
  })

  it.each([['в 1884 году'], ['31 іюня 1884'], ['5 марта 1925']])('gives nothing for %j', (text) => {
    expect(describeDate(text)).toBeUndefined()
  })
})

type CalendarDate = { year: number; month: number; day: number }

const firstGregorianDay: CalendarDate = { year: 1582, month: 10, day: 5 }
const lastJulianDay: CalendarDate = { year: 1918, month: 1, day: 31 }

const weekdays = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'п’ятниця', 'субота']

const monthStems: [RegExp, number][] = [
  [/^(генв|янв)/, 1],
  [/^[фѳ]ев/, 2],
  [/^мар/, 3],
  [/^апр/, 4],
  [/^ма[яй]$/, 5],
  [/^[иіi]юн/, 6],
  [/^[иіi]юл/, 7],
  [/^авг/, 8],
  [/^сен/, 9],
  [/^окт/, 10],
  [/^ноя/, 11],
  [/^дек/, 12],
]

const datePattern = /(?<!\d)(\d{1,2})(?:-?(?:го|е))?\s+(\p{L}+)\.?\s+(\d{4})(?!\d)/giu

const monthOf = (word: string) => monthStems.find(([stem]) => stem.test(word.toLowerCase()))?.[1]

export const parseDate = (text: string): CalendarDate | null => {
  for (const [, day, word, year] of text.matchAll(datePattern)) {
    const month = monthOf(word ?? '')
    if (month !== undefined) return { year: Number(year), month, day: Number(day) }
  }
  return null
}

const julianDaysIn = (year: number, month: number) =>
  month === 2 ? (year % 4 === 0 ? 29 : 28) : [4, 6, 9, 11].includes(month) ? 30 : 31

const compareDates = (a: CalendarDate, b: CalendarDate) =>
  a.year - b.year || a.month - b.month || a.day - b.day

const isConvertible = (date: CalendarDate) =>
  date.month >= 1 &&
  date.month <= 12 &&
  date.day >= 1 &&
  date.day <= julianDaysIn(date.year, date.month) &&
  compareDates(date, firstGregorianDay) >= 0 &&
  compareDates(date, lastJulianDay) <= 0

const julianDayNumber = ({ year, month, day }: CalendarDate) => {
  const shift = Math.floor((14 - month) / 12)
  const y = year + 4800 - shift
  const m = month + 12 * shift - 3
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083
}

const gregorianOf = (dayNumber: number): CalendarDate => {
  const a = dayNumber + 32044
  const b = Math.floor((4 * a + 3) / 146097)
  const c = a - Math.floor((146097 * b) / 4)
  const d = Math.floor((4 * c + 3) / 1461)
  const e = c - Math.floor((1461 * d) / 4)
  const m = Math.floor((5 * e + 2) / 153)
  return {
    year: 100 * b + d - 4800 + Math.floor(m / 10),
    month: m + 3 - 12 * Math.floor(m / 10),
    day: e - Math.floor((153 * m + 2) / 5) + 1,
  }
}

export const julianToGregorian = (date: CalendarDate) => {
  if (!isConvertible(date)) return null
  const dayNumber = julianDayNumber(date)
  return { date: gregorianOf(dayNumber), weekday: weekdays[(dayNumber + 1) % 7] ?? '' }
}

const iso = ({ year, month, day }: CalendarDate) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

export const dateExtra = (text: string) => {
  const julian = parseDate(text)
  const gregorian = julian && julianToGregorian(julian)
  return gregorian ? { newStyle: iso(gregorian.date), weekday: gregorian.weekday } : undefined
}

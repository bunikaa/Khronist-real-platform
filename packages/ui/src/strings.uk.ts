import type { Shelfmark } from '@khronist/contracts'

const plural = new Intl.PluralRules('uk')
const number = new Intl.NumberFormat('uk')

const lineForms: Record<Intl.LDMLPluralRule, string> = {
  zero: 'рядків',
  one: 'рядок',
  two: 'рядки',
  few: 'рядки',
  many: 'рядків',
  other: 'рядка',
}

const lines = (count: number) => `${count} ${lineForms[plural.select(count)]}`

export const strings = {
  brand: 'Хроніст',
  shelfmark: {
    place: (s: Shelfmark) => `${s.archive} · ф. ${s.fond}, оп. ${s.opys}, спр. ${s.sprava}`,
    page: (s: Shelfmark) => (s.folio === undefined ? `зобр. ${s.image}` : `арк. ${s.folio}`),
  },
  read: {
    promptTitle: 'Виділіть фрагмент скану',
    promptBody: 'Натисніть кнопку нижче або Alt + Shift + X, потім обведіть запис на аркуші.',
    selectFragment: 'Виділити фрагмент',
    selectingTitle: 'Обведіть запис на аркуші',
    selectingHint: 'Esc — скасувати',
    cancel: 'Скасувати',
    fragment: (width: number, height: number) =>
      `фрагмент скану · ${number.format(width)} × ${number.format(height)} px`,
    reading: 'Читання рукопису…',
    read: (count: number) => `Читання рукопису · ${count} знайдено`,
    normalizing: 'Нормалізація та сутності',
    transcription: 'Транскрипція',
    transcriptionLines: (count: number) => `Транскрипція · ${lines(count)}`,
    normalized: 'Сучасною орфографією',
    uncertainWord: 'Модель не впевнена в цьому слові',
    helps: 'Що допомагає',
    tips: ['Виділіть цілий запис, а не окреме слово', 'Збільште масштаб на порталі до 100 %'],
    selectAgain: 'Виділити знову',
    offline: 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз',
    badResponse: 'Сервер відповів неочікувано. Спробуйте ще раз',
  },
}

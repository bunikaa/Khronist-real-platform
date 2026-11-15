import type { ReadingWarning, Shelfmark } from '@khronist/contracts'

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
const size = (width: number, height: number) =>
  `${number.format(width)} × ${number.format(height)} px`

export const strings = {
  brand: 'Хроніст',
  shelfmark: {
    place: (s: Shelfmark) => `${s.archive} · ф. ${s.fond}, оп. ${s.opys}, спр. ${s.sprava}`,
    page: (s: Shelfmark) => (s.folio === undefined ? `зобр. ${s.image}` : `арк. ${s.folio}`),
  },
  page: {
    missingTitle: 'Відкрийте скан на підтримуваному порталі',
    missingBody:
      'Хроніст читає аркуші в переглядачі archium.cdiak.archives.gov.ua. Якщо справу вже відкрито, перезавантажте вкладку.',
  },
  read: {
    promptTitle: 'Виділіть фрагмент скану',
    promptBody: (shortcut: string | undefined) =>
      shortcut
        ? `Натисніть кнопку нижче або ${shortcut.split('+').join(' + ')}, потім обведіть запис на аркуші.`
        : 'Натисніть кнопку нижче, потім обведіть запис на аркуші.',
    selectFragment: 'Виділити фрагмент',
    selectingTitle: 'Обведіть запис на аркуші',
    selectingHint: 'Esc — скасувати',
    selectionTooSmall: 'Виділення замале: обведіть увесь запис',
    cancel: 'Скасувати',
    fragment: (width: number, height: number) => `фрагмент скану · ${size(width, height)}`,
    scaledFrom: (width: number, height: number) =>
      `Фрагмент зменшено з ${size(width, height)}, щоб модель прочитала його без стиснення й запит не перевищив 7 МіБ`,
    reading: 'Читання рукопису…',
    read: (count: number) => `Читання рукопису · ${count} знайдено`,
    normalizing: 'Нормалізація та сутності',
    transcription: 'Транскрипція',
    transcriptionLines: (count: number) => `Транскрипція · ${lines(count)}`,
    normalized: 'Сучасною орфографією',
    expansions: 'Розкриті скорочення',
    expansion: (from: string, to: string) => `${from} → ${to}`,
    uncertainWord: 'Модель не впевнена в цьому слові',
    uncertainMark: 'непевно',
    warnings: {
      cut_off_left: 'Виділення обрізає текст ліворуч',
      cut_off_right: 'Виділення обрізає текст праворуч',
      cut_off_top: 'Виділення обрізає текст згори',
      cut_off_bottom: 'Виділення обрізає текст знизу',
      damaged_paper: 'Папір пошкоджено: частину тексту може бути не видно',
      faint_ink: 'Бліде чорнило: частину слів прочитано непевно',
    } satisfies Record<ReadingWarning, string>,
    helps: 'Що допомагає',
    tips: ['Виділіть цілий запис, а не окреме слово'],
    selectAgain: 'Виділити знову',
    retry: 'Спробувати ще раз',
    tooLarge: 'Фрагмент завеликий або пошкоджений. Виділіть меншу ділянку',
    stalled: 'Сервер не завершив читання. Спробуйте ще раз',
    fragmentFailed: {
      outside: 'Виділення не потрапило на скан. Обведіть запис на самому зображенні',
      not_loaded: 'Скан ще завантажується. Зачекайте й виділіть знову',
      crop: 'Не вдалося вирізати фрагмент зі скану. Перезавантажте вкладку й спробуйте ще раз',
    },
    offline: 'Немає зв’язку із сервером. Перевірте мережу й спробуйте ще раз',
    badResponse: 'Сервер відповів неочікувано. Спробуйте ще раз',
  },
}

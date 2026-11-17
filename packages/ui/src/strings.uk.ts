import {
  maxSearchQueryLength,
  maxSignatureLength,
  type CiteRequest,
  type Entity,
  type ReadingWarning,
  type Shelfmark,
} from '@khronist/contracts'

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
const dayMonthYear = new Intl.DateTimeFormat('uk', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
})
const relative = new Intl.RelativeTimeFormat('uk', { style: 'short' })
const minuteMs = 60_000

const ago = (date: Date, now: Date) => {
  const minutes = Math.floor((now.getTime() - date.getTime()) / minuteMs)
  if (minutes < 1) return 'щойно'
  if (minutes < 60) return relative.format(-minutes, 'minute')
  if (minutes < 24 * 60) return relative.format(-Math.floor(minutes / 60), 'hour')
  return dayMonthYear.format(date)
}

const fragmentForms: Record<Intl.LDMLPluralRule, string> = {
  zero: 'фрагментів',
  one: 'фрагмент',
  two: 'фрагменти',
  few: 'фрагменти',
  many: 'фрагментів',
  other: 'фрагмента',
}

const transcriptionForms: Record<Intl.LDMLPluralRule, string> = {
  zero: 'транскрипцій',
  one: 'транскрипцію',
  two: 'транскрипції',
  few: 'транскрипції',
  many: 'транскрипцій',
  other: 'транскрипції',
}

const entityTypes: Record<Entity['type'], string> = {
  person: 'Особа',
  place: 'Місце',
  term: 'Термін',
  date: 'Дата',
}

const lineNumber = (idx: number) => String(idx + 1).padStart(2, '0')
const lineNumbers = (idxs: number[]) =>
  `${idxs.length === 1 ? 'рядок' : 'рядки'} ${idxs.map(lineNumber).join(', ')}`
const shortcutKeys = (shortcut: string) => shortcut.split('+').join(' + ')

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
        ? `Натисніть кнопку нижче або ${shortcutKeys(shortcut)}, потім обведіть запис на аркуші.`
        : 'Натисніть кнопку нижче, потім обведіть запис на аркуші.',
    selectFragment: 'Виділити фрагмент',
    notRead: 'ще не прочитано',
    alreadyRead: (count: number, verified: number) =>
      `прочитано · ${count} ${fragmentForms[plural.select(count)]}` +
      (verified > 0 ? ` · підтверджено ${verified}` : ''),
    readHere: 'Уже прочитано на цьому аркуші',
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
    timedOut: 'Сервер не відповів вчасно. Спробуйте ще раз',
  },
  edit: {
    editing: 'ви редагуєте',
    hint: 'Enter — наступний рядок · Esc — відміна',
    line: (number: number) => `Рядок ${number}`,
    changed: 'виправлено',
    oldLetters: 'Старі літери',
    insert: (letter: string) => `Вставити ${letter}`,
    conflictBy: (idxs: number[], name: string) =>
      name
        ? `Поки ви редагували, ${lineNumbers(idxs)} змінив(ла) ${name}`
        : `Поки ви редагували, ${lineNumbers(idxs)} змінили`,
    compare: 'Порівняти',
    disputed: (idxs: number[]) => `спірне · ${lineNumbers(idxs)}`,
    versions: (idx: number) => `Рядок ${lineNumber(idx)} · дві версії`,
    mine: 'Ваша',
    theirs: (name: string, date: Date, now: Date) => `${name || 'Нова версія'} · ${ago(date, now)}`,
    keepMine: 'Залишити моє',
    takeTheirs: 'Прийняти чуже',
    showCurrent: 'Показати нову версію',
    signInToSave: 'Правки не збережено: щоб зберегти їх, увійдіть',
    discard: 'Скасувати правки',
  },
  entity: {
    section: 'Сутності',
    type: (type: Entity['type']) => `${entityTypes[type]}: `,
  },
  explain: {
    label: {
      person: 'Пояснення імені',
      place: 'Пояснення топоніма',
      term: 'Пояснення терміна',
      date: 'Пояснення дати',
    } satisfies Record<Entity['type'], string>,
    loading: 'Шукаємо в довідковому корпусі…',
    noSources: 'У довідковому корпусі немає пояснення.',
    unavailable: 'Пояснення зараз недоступне.',
    lowConfidence: 'Джерела відповідають лише частково, звірте зі статтею',
    date: 'Дата',
    oldStyle: (date: string) => `${date}, ст. ст.`,
    newStyle: (date: string) => `${date}, н. ст.`,
    weekday: 'День тижня',
    source: (licence: string, retelling: boolean) =>
      retelling ? `переказ статті · ${licence}` : licence,
    close: 'Закрити',
  },
  cite: {
    title: 'Цитата',
    format: 'Формат цитати',
    formats: { dstu: 'ДСТУ', markdown: 'Markdown', text: 'Текст' } satisfies Record<
      CiteRequest['format'],
      string
    >,
    withTranscription: 'З транскрипцією',
    loading: 'Складаємо цитату…',
    copy: 'Скопіювати',
    copied: 'Скопійовано',
    copyFailed: 'Не вдалося скопіювати. Виділіть текст цитати й скопіюйте вручну',
  },
  confirm: {
    action: 'Підтвердити',
    question: (count: number) =>
      `Підтвердити ${lines(count)} як ${plural.select(count) === 'one' ? 'прочитаний' : 'прочитані'} вами?`,
    licence: (signature: string) =>
      signature
        ? `Текст стане публічним під CC BY 4.0 з підписом «${signature}».`
        : 'Текст стане публічним під CC BY 4.0 без підпису. Підпис можна додати в профілі.',
    dontAsk: 'Більше не питати',
    cancel: 'Скасувати',
    next: 'Наступний фрагмент',
    draft: 'чернетка моделі',
    nobodyYet: 'ще ніхто не підтвердив',
    verified: 'підтверджено',
    today: 'сьогодні',
    unsigned: 'без підпису',
    verifiedBy: (who: string, date: string) =>
      who ? `Цей фрагмент підтвердив(ла) ${who} ${date}` : `Цей фрагмент підтверджено ${date}`,
    suggestFix: 'Запропонувати виправлення',
    disputed: 'спірне',
    signedAs: (name: string, signature: string) => `${name} («${signature}»)`,
    date: (date: Date) => dayMonthYear.format(date),
    conflict: 'Текст змінили, поки ви його читали. Перегляньте нову версію перед підтвердженням',
    signInAgain: 'Увійдіть знову, щоб підтвердити',
  },
  account: {
    signInLabel: 'Увійти',
    profileLabel: 'Профіль',
    dismiss: 'Зрозуміло',
    firstRun: {
      intro:
        'Читайте архівні скани прямо на порталі: рукопис стає текстом, терміни й дати отримують пояснення з джерелами.',
      steps: [
        'Відкрийте скан на archium',
        'Виділіть фрагмент — Хроніст прочитає його за кілька секунд',
        'Виправте й підтвердьте — сторінка стане читабельною для всіх',
      ],
      shortcut: 'Гаряча клавіша',
      start: 'Почати без входу',
      signIn: 'Увійти',
      why: 'Вхід потрібен лише для правок і підтвердження.',
    },
    signIn: {
      title: 'Увійти',
      intro: 'Надішлемо код для входу. Пароль не потрібен.',
      email: 'Електронна пошта',
      emailPlaceholder: 'ваша@пошта.ua',
      send: 'Надіслати код',
      sent: 'Код надіслано',
      sentBody: (email: string) =>
        `Код надіслано на ${email}. Введіть 6 цифр із листа — код діє 5 хвилин.`,
      code: 'Код із листа',
      submit: 'Увійти',
      resend: 'Надіслати ще раз',
      resendIn: (seconds: number) =>
        `Надіслати ще раз через ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
      otherEmail: 'Інша адреса',
    },
    profile: {
      noName: 'Підпис не задано',
      signature: 'Підпис підтверджень',
      signatureMissing: 'Не задано',
      signatureHint: 'Підпис видно всім поруч із вашими правками й підтвердженнями.',
      signatureInvalid: `Підпис — від 1 до ${maxSignatureLength} символів, без керуючих символів`,
      save: 'Зберегти',
      cancel: 'Скасувати',
      shortcut: 'Гаряча клавіша',
      shortcutMissing: 'Не призначено',
      signOut: 'Вийти',
    },
  },
  web: {
    title: 'Пошук у Commons',
    intro:
      'Транскрипції архівних аркушів, прочитаних у Хроністі. Чернетки моделі ще не перевірені людьми; підтверджені тексти відкриті під CC BY 4.0.',
    query: 'Прізвище, ім’я або назва села',
    queryPlaceholder: 'напр. Коваленко',
    queryInvalid: `Запит — від 1 до ${maxSearchQueryLength} символів`,
    queryNoWords:
      'Додайте прізвище, ім’я чи назву від трьох літер: числа, римські цифри й службові слова пошук не враховує',
    search: 'Шукати',
    archive: 'Архів',
    archivePlaceholder: 'напр. ЦДІАК України',
    fond: 'Фонд',
    fondPlaceholder: 'напр. 127',
    yearFrom: 'Рік від',
    yearTo: 'Рік до',
    yearsInvalid: 'Рік — від 1000 до 2100, і «від» не пізніший за «до»',
    verifiedOnly: 'Лише підтверджені',
    searching: 'Шукаємо…',
    results: 'Результати пошуку',
    found: (count: number, more: boolean) =>
      `${more ? 'Показано' : 'Знайдено'} ${count} ${transcriptionForms[plural.select(count)]}` +
      (more ? ', є ще' : ''),
    years: (from: number | undefined, to: number | undefined) =>
      from !== undefined && to !== undefined && from !== to
        ? `${from}–${to}`
        : String(from ?? to ?? ''),
    openPortal: 'Відкрити скан на порталі',
    nothing: 'Нічого не знайдено',
    nothingVerified:
      'Серед підтверджених транскрипцій збігів немає. Можна шукати й у чернетках моделі, ще не перевірених людьми.',
    includeDrafts: 'Шукати й у чернетках',
    nothingHint: 'Спробуйте інше написання.',
    nothingFiltered: 'Спробуйте інше написання або приберіть фільтри.',
    more: 'Показати ще',
    loadingMore: 'Завантажуємо…',
    rateLimited: (seconds: number | undefined) =>
      seconds === undefined
        ? 'Забагато пошуків поспіль. Спробуйте за хвилину'
        : `Забагато пошуків поспіль. Спробуйте за ${seconds} с`,
    rejected: 'Сервер не прийняв цей запит',
    restart: 'Почати пошук спочатку',
    editQuery: 'Змінити запит',
    unavailable: 'Сервер тимчасово недоступний. Спробуйте за хвилину',
    retry: 'Спробувати ще раз',
  },
  tabs: {
    label: 'Розділи панелі',
    read: 'Читання',
    ask: 'Спитати',
  },
  chat: {
    context: (page: string | undefined, count: number) =>
      page ? `Контекст: ${page}, ${lines(count)} прочитано` : `Контекст: ${lines(count)} прочитано`,
    contextSwitch: 'Відповідати з урахуванням прочитаного фрагмента',
    intro:
      'Запитайте про терміни, дати, місця чи прочитаний фрагмент. Хроніст відповідає лише за джерелами й показує їх під відповіддю.',
    author: 'Хроніст',
    waiting: 'Шукаю відповідь у джерелах…',
    lowConfidence: 'Джерела відповідають лише частково — перевірте за ними',
    unknown: (withRecord: boolean) =>
      withRecord
        ? 'У записі й довідковому корпусі немає відповіді на це запитання.'
        : 'У довідковому корпусі немає відповіді на це запитання.',
    sources: 'Джерела',
    recordSource: 'з транскрипції фрагмента',
    chunkSource: (licence: string, retelling: boolean) =>
      retelling ? `переказ статті · ${licence}` : licence,
    placeholder: (withRecord: boolean) =>
      withRecord ? 'Запитати про цей аркуш…' : 'Запитати про термін, дату чи місце…',
    question: 'Запитання',
    send: 'Надіслати',
    followups: 'Можна спитати далі',
    restartNeeded: 'Не вдалося надіслати запитання з цією розмовою. Почніть нову',
    restart: 'Почати нову розмову',
  },
  shortcutKeys,
}

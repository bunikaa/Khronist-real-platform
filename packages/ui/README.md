# packages/ui

Дизайн-система Хроніста: тема daisyUI `khronist`, токени й компоненти з Figma (файл `4UXNnyAAyCxTI5NqMtvQPM`, сторінка «01 Foundations · Components»).

## Підключення

Застосунок збирає стилі через Tailwind CSS 4 (`@tailwindcss/vite`) і імпортує їх один раз:

```css
@import '@khronist/ui/styles.css';
```

`styles.css` підключає шрифти (Inter, Source Serif 4, JetBrains Mono) і `theme.css` — Tailwind, daisyUI з темою `khronist` і `@source` з класами компонентів пакета. Там, де шрифти не потрібні й шкодять, підключається лише `@khronist/ui/theme.css`: так робить накладка виділення на сторінці порталу, щоб її `@font-face` не перебили шрифти сайту. Шрифти підключаються файлами ваги (`400.css`, `500.css`): у них кожен набір символів оголошено з `unicode-range`, тож латиниця, кирилиця й розширена кирилиця (ѣ, ѳ, ѵ) беруться з потрібних файлів. Окремі файли наборів (`cyrillic-400.css`) не використовувати: вони без `unicode-range`, і браузер бере лише одне з однакових оголошень.

## Як переносимо з Figma

- Кольори: surface/1–3 → `base-100`–`base-300`, ink/default → `base-content`, accent → `primary`, status/verified → `success`, status/uncertain → `warning`, status/danger → `error`. Решта — окремі кольори Tailwind: `ink-muted`, `rule`, `accent-soft`.
- Текстові стилі Figma — утиліти з тією самою назвою: `label/13` → `text-label-13`, `mono/transcription` → `text-mono-transcription` (для mono-стилів ще `font-mono`).
- Відступи space/1…12 (4…48 px) збігаються зі шкалою Tailwind (`p-1`…`p-12`), окремих токенів немає.
- Компонент спирається на класи daisyUI, а розміри й типографіку з Figma задає утилітами поверх них. Пропси — лише варіанти з Figma; решта атрибутів передається як є.

Тексти інтерфейсу — у `src/strings.uk.ts`, щоб їх можна було редагувати без пошуку по коду.

Іконки беруться з `lucide-react`: набір у Figma — Lucide з тими самими назвами. Іконка 16 px має лінію 1,33 px, як стандартна 2 px на 24; для інших розмірів — `strokeWidth={4 / 3}` з `absoluteStrokeWidth`.

## Компоненти

| Компонент | Figma | Пропси |
| --- | --- | --- |
| `Button` | Button (Kind, Size) | `kind`: `primary` · `outline` · `ghost`; `size`: `sm` (28 px, панель) · `md` (36 px, робоче місце) |
| `ActionBar` | ActionBar (State) | `children`: кнопки стану. Панель 48 px із лінією згори; набір кнопок задає екран, рівно одна primary |
| `PanelHeader` | PanelHeader | `shelfmark?`: шифр відкритого скану (`Shelfmark` з контрактів); без нього — лише логотип. Шифр обрізається з кінця першої частини, номер аркуша або зображення лишається видимим. `account?: { label, open, onToggle }`: квадратна ghost-кнопка 24 px з іконкою `User` справа (`aria-label` — «Увійти» або «Профіль», `aria-pressed={open}`, при відкритому екрані — фон base-300) |
| `TextField` | Input (State: Default · Focus · Error) | `label`: підпис над полем (`label/13`, відступ 4 px), пов'язаний з полем через `useId`; `invalid`: стан Error (рамка error, `aria-invalid`). Поле 32 px, відступи 12 px, радіус 4, рамка rule; у фокусі — рамка base-content 1,5 px (1 px рамки й 0,5 px внутрішнього кільця). Решта атрибутів іде в `input` |
| `SettingsRow` | Row (A3 · Профіль) | `label`, `value`, `onSelect`, `expanded?`, `disabled?`. Кнопка 39 px: підпис body-13 не стискається, значення ink-muted обрізається з кінця, шеврон 16 px, лінія rule знизу |
| `SelectionOverlay` | ScanLineBox (Tone=Draft) | `onSelect(rect)`: прямокутник у координатах вікна, лише якщо обидві сторони не менші за 24 px (інакше накладка просить обвести весь запис), `onCancel()`: Esc. Накриває вікно, малює рамку пунктиром accent із заливкою accent-soft. Окремого макета накладки немає, вигляд узято з `ScanLineBox` |
| `SectionLabel` | SectionLabel | `children`: назва секції; великими літерами, `label/section`, ink-muted |
| `StatusBar` | StatusBar (Type) | `type`: `info` · `success` · `warning` · `error` (іконки info, check-circle, alert-circle, wifi-off у кольорі стану); `message`: одне речення; `action` і `onAction`: одна дія |
| `TranscriptionLine` | TranscriptionLine (State, Confidence) | `line`: рядок із контрактів. Номер з 01, текст `mono/transcription`; непевні слова мають колір тексту base-content і пунктир warning під ним (контраст ≥ 4,5:1), підказку «Модель не впевнена в цьому слові» й прихований для очей текст «(непевно)» для читачів екрана (якщо модель не дала слів — увесь рядок). Ті самі позначки дає `LineWords` для нормалізованих рядків. Hover — фон base-300. Стани Editing і Changed з'являться разом із редагуванням |

Одна primary-кнопка на екран; outline — вторинна дія; ghost — дії в панелі дій.

Primary і ghost на 2 px ширші за макет: у daisyUI кожна кнопка має рамку 1 px (кольору фону або прозору).

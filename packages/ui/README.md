# packages/ui

Дизайн-система Хроніста: тема daisyUI `khronist`, токени й компоненти з Figma (файл `4UXNnyAAyCxTI5NqMtvQPM`, сторінка «01 Foundations · Components»).

## Підключення

Застосунок збирає стилі через Tailwind CSS 4 (`@tailwindcss/vite`) і імпортує їх один раз:

```css
@import '@khronist/ui/styles.css';
```

`styles.css` підключає Tailwind, daisyUI з темою `khronist`, шрифти (Inter, Source Serif 4, JetBrains Mono) і через `@source` додає класи компонентів пакета. Шрифти підключаються файлами ваги (`400.css`, `500.css`): у них кожен набір символів оголошено з `unicode-range`, тож латиниця, кирилиця й розширена кирилиця (ѣ, ѳ, ѵ) беруться з потрібних файлів. Окремі файли наборів (`cyrillic-400.css`) не використовувати: вони без `unicode-range`, і браузер бере лише одне з однакових оголошень.

## Як переносимо з Figma

- Кольори: surface/1–3 → `base-100`–`base-300`, ink/default → `base-content`, accent → `primary`, status/verified → `success`, status/uncertain → `warning`, status/danger → `error`. Решта — окремі кольори Tailwind: `ink-muted`, `rule`, `accent-soft`.
- Текстові стилі Figma — утиліти з тією самою назвою: `label/13` → `text-label-13`, `mono/transcription` → `text-mono-transcription` (для mono-стилів ще `font-mono`).
- Відступи space/1…12 (4…48 px) збігаються зі шкалою Tailwind (`p-1`…`p-12`), окремих токенів немає.
- Компонент спирається на класи daisyUI, а розміри й типографіку з Figma задає утилітами поверх них. Пропси — лише варіанти з Figma; решта атрибутів передається як є.

Тексти інтерфейсу — у `src/strings.uk.ts`, щоб їх можна було редагувати без пошуку по коду.

## Компоненти

| Компонент | Figma | Пропси |
| --- | --- | --- |
| `Button` | Button (Kind, Size) | `kind`: `primary` · `outline` · `ghost`; `size`: `sm` (28 px, панель) · `md` (36 px, робоче місце) |
| `PanelHeader` | PanelHeader | `shelfmark?`: шифр відкритого скану (`Shelfmark` з контрактів); без нього — лише логотип. Шифр обрізається з кінця першої частини, номер аркуша або зображення лишається видимим. Меню користувача з'явиться разом із входом |

Одна primary-кнопка на екран; outline — вторинна дія; ghost — дії в панелі дій.

Primary і ghost на 2 px ширші за макет: у daisyUI кожна кнопка має рамку 1 px (кольору фону або прозору).

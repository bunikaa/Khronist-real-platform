# 03 · Фронтенд: розширення Chrome і веб-застосунок

Відповідальний: Владислав. Код у `apps/extension`, `apps/web`, спільні компоненти в `packages/ui`.

## 1. Стек

| Частина | Вибір | Версія | Примітка |
| --- | --- | --- | --- |
| Фреймворк розширення | WXT | 0.21.x | Manifest V3, HMR, збірка під Chrome |
| UI | React 19 + TypeScript | — | ті самі версії, що й на сайті |
| Стилі | Tailwind CSS 4 + daisyUI 5 | 4.3 / 5.7 | тема `khronist` із сайту переноситься в `packages/ui` |
| Дані | TanStack Query 5 | 5.x | кеш запитів, повторні спроби, статуси |
| Стан UI | Zustand | останній | вибрана область, активна вкладка, стан панелі |
| Клієнт API | згенерований із `packages/contracts` | — | типобезпечні виклики, один базовий URL із env |
| Веб-застосунок | Vite 8 + React 19 + React Router 8 | — | той самий стек, що й сайт |
| Іконки | lucide-react | 1.x | лише в інтерфейсі, не як декор |
| Тести | Vitest + Playwright | — | Playwright відкриває Chrome із завантаженим розширенням |

## 2. Розширення: архітектура

```
apps/extension/
├── wxt.config.ts            manifest: side_panel, permissions (activeTab, scripting, storage, sidePanel), host_permissions для порталу
├── entrypoints/
│   ├── background.ts        відкриття панелі за хоткеєм, обмін повідомленнями, captureVisibleTab як резерв
│   ├── archium.content.tsx  content script для ARCHIUM: накладка виділення, шифр, вирізання фрагмента
│   └── (portal/, scan/, api/ поруч із entrypoints: адаптер ARCHIUM, вирізання, клієнт API)
│   └── sidepanel/           React-застосунок панелі
│       ├── App.tsx          оболонка: PanelHeader, Tabs, StatusBar, Content, ActionBar
│       ├── screens/         ReadTab, AskTab, FirstRun, Login, Profile; NotesTab — should
│       ├── state/           zustand store: page, region, recognition, ui
│       └── api/             хуки TanStack Query над клієнтом контрактів, SSE-підписка
├── public/icons/
└── tests/
```

**PortalAdapter** — інтерфейс, який робить підтримку нового порталу однією задачею:

```ts
interface PortalAdapter {
  matches(url: URL): boolean
  readShelfmark(doc: Document, url: URL): Shelfmark | null
  findScanImage(doc: Document): HTMLImageElement | HTMLCanvasElement | null
  imageSourceUrl(doc: Document): string | null
}
```

Шифр читаємо з DOM переглядача ARCHIUM за правилами з `docs/portal-searcharchives.md`, розділ 6. Якщо шифр не розпізнано — читання й пояснення працюють без нього; ручний ввід шифру з'явиться разом із підтвердженням, яке без шифру неможливе.

**Захоплення області.** Накладка малює прямокутник поверх зображення; content script вирізає фрагмент через `OffscreenCanvas` з оригінального `<img>` (якщо CORS дозволяє; перевірити 2–3 листопада) або просить background зробити `chrome.tabs.captureVisibleTab` і вирізати з нього. Фрагмент, більший за 2576 px по довшій стороні або 3,75 Мп, зменшується, а PNG — до менше ніж 7 МіБ (рішення 15 листопада); менший надсилається як є. Координати зберігаються в частках від розміру оригіналу. Хеш фрагмента (SHA-256 від PNG) рахується на клієнті.

**Потік даних.** Панель викликає `POST /v1/recognitions`, отримує `recognitionId`, підписується на `GET /v1/recognitions/:id/events` через `EventSource`; події оновлюють store, рядки з'являються по одному. Наведення на рядок у панелі шле повідомлення content script для підсвітки на скані, і навпаки.

**Підсвітка рядків.** Рядок має `box` і `boxSource`. При `model` накладка малює рамку за координатами; при `estimated` — напівпрозору горизонтальну смугу на всю ширину виділеної області, без рамки й без претензії на точність. Непевні слова в панелі підкреслені пунктиром (`TranscriptionLine` зі стану Figma); підказка пояснює: «Модель не впевнена в цьому слові».

**Стани панелі** — рівно ті, що в дизайн-специфікації: A1–A3, B1–B7, C1–C2, D1, E1–E4; D2 (нотатник) — should. Усі помилки показує `StatusBar` з однією дією. Жодних модальних вікон.

**Гаряча клавіша.** `Alt+Shift+X` через `commands` у маніфесті; повторне натискання при відкритій панелі вмикає режим виділення.

**Авторизація в розширенні.** Код із листа (Better Auth `emailOTP`): панель надсилає пошту, користувач вводить 6 цифр, панель отримує токен сесії із заголовка `set-auth-token`, тримає його в `chrome.storage.session` і шле в `Authorization: Bearer`. Cookie й CORS розширенню не потрібні: API доступний через `host_permissions` (рішення 14 і 15 листопада).

## 3. Веб-застосунок (`apps/web`)

Vite SPA на піддомені (`app.khronist.org`). Для MVP обов'язкові: **W5 Пошук у Commons** (публічний, без входу; результати з шифром, роком, фрагментом, статусом і посиланням на портал) і **спрощені W2–W3** (завантажити власний скан → виділити → прочитати → підтвердити; панель читання — той самий компонент, що й у розширенні, з `packages/ui`). W1, W4, W6 — після фіналу. Якщо на вечір 16 листопада Commons у проді не готовий, W2–W3 ріжуться за таблицею з `00`.

Переглядач скану: `<img>` з CSS-трансформацією для масштабу, рядки як абсолютно позиціоновані `div` у частках; виділення — та сама накладка, що й у content script, винесена в `packages/ui`.

## 4. Дизайн-система в коді (`packages/ui`)

Переносимо з Figma один до одного: змінні → CSS custom properties та тема daisyUI, текстові стилі → класи-утиліти, компоненти → React-компоненти з тими самими іменами й варіантами: Button(kind, size), Tab(state), StatusBar(type), PageStatusBadge(status), TranscriptionLine(state, uncertain), EntityChip(type, state), FactPair, SourceRef, OldLettersBar, ScanLineBox(tone), PanelHeader, ActionBar(state), EmptyState, ChatMessage(kind), ChatComposer, ExplainSheet, CitationSheet, ConfirmDialog, Input(state); NoteItem — should. Токени й значення — у `docs/project-context.md`, розділ 10. Темна тема не входить у MVP.

Шрифти — `@fontsource/inter`, `@fontsource/jetbrains-mono`, `@fontsource/source-serif-4`; у розширенні пакуються в бандл (CSP розширення забороняє зовнішні).

## 5. Якість

- Панель перевіряється на ширинах 320, 360, 480.
- Усі тексти інтерфейсу — в одному файлі `packages/ui/src/strings.uk.ts`, щоб їх могла редагувати Дарія без пошуку по коду.
- Playwright: сценарій «відкрити локальну копію сторінки порталу → натиснути хоткей → виділити → отримати 3 рядки з мок-API» запускається в CI.
- Доступність: фокус-кільця, `aria-live` для StatusBar, навігація клавіатурою по рядках (стрілки, Enter — редагувати, Esc — відміна).

## 6. Порядок робіт

| Дата | Що |
| --- | --- |
| Нд 8 | `packages/ui`: токени, Button, Tab, StatusBar, TranscriptionLine, PageStatusBadge, EntityChip; каркас WXT: side panel, background, хоткей |
| Пн 9 | content script: адаптер searcharchives, парсинг шифру, накладка виділення, вирізання, хеш |
| Вт 10 | ReadTab проти API: SSE, рядки по одному, смуги на скані, непевні слова |
| Ср 11 | редагування рядків, OldLettersBar, ConfirmDialog, «Підтвердити», бейдж «уже прочитано» |
| Чт 12 | ExplainSheet, FactPair, SourceRef для «Пояснити»; репетиція |
| Сб 14 | стани E1–E4, FirstRun, Login, Profile, виправлення дефектів |
| Нд 15 | EntityChip у транскрипції, пояснення топонімів і дат |
| Вт 17 | AskTab, ChatMessage, ChatComposer; CitationSheet |
| Ср 18 | `apps/web`: W5 пошук, спрощені W2–W3 |
| Чт 19 | ширини 320/360/480, швидкість, доступність |

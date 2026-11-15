# 07 · Контракти між частинами

Єдине джерело правди на межах: бекенд ↔ клієнти, бекенд ↔ HTR-сервіс (трек B), бекенд ↔ інгестія корпусу, MCP ↔ бекенд. Реалізуються як Zod-схеми в `packages/contracts` (TypeScript) і Pydantic-моделі в `services/*` (Python, зараз — `services/knowledge/src/khronist_knowledge/corpus.py`). Зараз в API працюють `/health`, вхід `/api/auth/*`, `/v1/recognitions*`, `GET /v1/transcriptions/:id` і `GET /v1/pages/lookup`; решта маршрутів — контракт для задач V-xx, і колонки та змінні для них з'являються разом із ними. Зміна контракту — спочатку PR у цей документ і в `packages/contracts`, потім код.

Спільні правила: JSON, UTF-8; ідентифікатори — UUID; час — ISO 8601 UTC; координати — частки 0…1 від ширини й висоти зображення (`x`, `y` — лівий верхній кут); помилки — `{ "error": { "code": "snake_case", "message": "людською мовою українською" } }`. Будь-який запит під час зупинки сервера отримує `503 { error: { code: 'shutting_down' } }` із `retry-after`. Кожна відповідь несе `x-request-id` (з `x-railway-request-id`, якщо його поставив Railway).

## 1. Спільні типи

```ts
Shelfmark = { archive: string; fond: string; opys: string; sprava: string; folio?: string; image?: number; portal?: 'archium' | 'own'; portalUrl?: string }   // потрібне хоча б одне з folio, image
Box = { x: number; y: number; w: number; h: number }
Word = { text: string; uncertain: boolean; confidence?: number }            // confidence лише від HTR-сервісу
Line = { idx: number; text: string; box: Box; boxSource: 'model' | 'estimated'; uncertain: boolean; words: Word[] }
NormalizedLine = { text: string; words: { text: string; uncertain: boolean }[] }
Entity = { type: 'person' | 'place' | 'term' | 'date'; text: string; start: number; end: number; normalized?: string; wikidataId?: string; extra?: Record<string, unknown> }
Citation = { kind: 'chunk'; chunkId: string; sourceId: string; title: string; url?: string; licence: string; retelling: boolean; quote: string }
RecordCitation = { kind: 'record'; transcriptionId: string; quote: string }   // цитата із самої транскрипції, лише в чаті
ReadingWarning = 'cut_off_left' | 'cut_off_right' | 'cut_off_top' | 'cut_off_bottom' | 'damaged_paper' | 'faint_ink'
TranscriptionStatus = 'draft' | 'verified' | 'disputed'
RecognitionStatus = 'queued' | 'reading' | 'normalizing' | 'done' | 'failed'
Hints = { language?: 'uk' | 'ru' | 'church-slavonic' | 'pl'; period?: '17' | '18' | '19' | '20'; documentType?: 'metric' | 'revision' | 'court' | 'other' }
```

`Citation.licence` — ліцензія джерела (`суспільне надбання`, `CC BY-SA 4.0`); `retelling: true` — текст чанка є українським переказом джерела, панель підписує його «переказ статті», а не цитатою з першоджерела. `Hints.period` — століття рядком (`'17'`…`'20'`); це єдиний формат періоду в запитах, а `periodFrom`/`periodTo` джерел і чанків — ті самі століття числами.

## 2. Ядро API (`apps/api`, префікс `/v1`)

### Розпізнавання
```
POST /v1/recognitions
  body: { shelfmark?: Shelfmark; image: { base64Png: string }; box?: Box; imageHash: string; source: 'extension' | 'web' | 'mcp' | 'batch'; hints?: Hints; document?: { yearFrom, yearTo } }
  201: { recognitionId, status: 'queued' | 'cached', transcriptionId?: string }
GET  /v1/recognitions/:id
  200: { recognitionId, status: RecognitionStatus, transcription?: Transcription, error?: { code, message } }
GET  /v1/recognitions/:id/events      text/event-stream
  events: progress { status } · line { line: Line } · done { transcriptionId } · failed { code, message }
  codes: read_failed · normalize_failed · save_failed · restarted · bad_image · too_large
  помилки POST: 400 bad_request · 400 bad_image · 413 too_large · 429 too_many_requests · 503 reader_unavailable
```

- Від гостя сервер зберігає лише ідентичність аркуша: архів, фонд, опис, справу і номер зображення (або аркуш, якщо зображення немає). `portal`, `portalUrl`, `folio` поряд із номером зображення і `document` гостя не зберігаються: перший запит не може назавжди задати метадані сторінки. Їх задають пакетна обробка з ключем API (V-14) і підтвердження.
- Перевірки йдуть до будь-якого запису: кеш за хешем (відповідь із кешу створює рядок `recognitions`, а якщо регіон ще без сторінки — документ і сторінку з шифру запиту), денний бюджет моделей, місце в черзі, денний ліміт гостя; лише потім створюються документ, сторінка й регіон. Відхилений запит не створює даних; єдиний запис до перевірок — закриття зависшого понад 10 хвилин розпізнавання того самого фрагмента. Денний ліміт витрачається перед вставкою, тож рідкі гонки (паралельний запит устиг першим) теж його витрачають.
- Ліміти гостя за IP (заголовок `CLIENT_IP_HEADER`): 10 `POST` на хвилину (зокрема відповіді з кешу); `GUEST_RECOGNITIONS_PER_DAY` нових читань на добу (за замовчуванням 300, відповіді з кешу не рахуються); 3 активні розпізнавання одночасно; 120 `GET` стану й потоку на хвилину разом; 5 відкритих потоків на IP і 300 на сервер. Понад ліміт — `429 too_many_requests` з `retry-after`.
- `MODEL_CALLS_PER_DAY` — спільний денний бюджет викликів моделей у PostgreSQL (UTC-доба, переживає деплой, резервна модель рахується в той самий бюджет). Вичерпано — `503 reader_unavailable` до виклику моделі. Помилки ліміту й білінгу провайдера (429, 402) на резервну модель не перемикають.
- Бюджети часу задачі: читання 75 с (основна модель 15 с, решта — резервній), нормалізація 25 с (основна модель 10 с), сутності 20 с (основна модель 8 с). Сервер щохвилини закриває кодом `restarted` активні розпізнавання, старші за 10 хвилин; потік, задачу якого виконує інший екземпляр, раз на 15 с перевіряє стан у базі й віддає результат, щойно він там з'явився. Збій нормалізації зберігає прочитані рядки без `normalizedLines`; збій сутностей — транскрипцію з `entities: []`. `normalize_failed` лишається лише для неочікуваної помилки на цьому етапі.

### Аркуші й транскрипції
```
GET  /v1/pages/lookup?archive&fond&opys&sprava&folio&image
  200: { page?: { id, shelfmark, transcriptions: TranscriptionSummary[] } }
  TranscriptionSummary = { id, regionId, box, version, status, createdAt }      // остання версія кожного регіону
GET  /v1/transcriptions/:id
  200: Transcription = { id, regionId, shelfmark?, box, version, status, lines: Line[], normalizedText, normalizedLines?: NormalizedLine[], expansions?: { from, to }[], entities: Entity[], warnings?: ReadingWarning[], reader, author?: { name }, verifiedBy?: { name }, verifiedSignature?, verifiedAt?, createdAt }
PATCH /v1/transcriptions/:id/lines          (вхід обов'язковий)
  body: { baseVersion: number; lines: [{ idx, text }] }          // до 200 рядків, текст до 500 символів без переносу, idx без повторів
  200: Transcription (нова версія) · 409 { error: { code: 'version_conflict' }, current: Transcription }   → стан E4
POST /v1/transcriptions/:id/verify          (вхід обов'язковий, лише VERIFIER_EMAILS)
  body: { signature?: string }               // до 80 символів, без керуючих
  200: Transcription (status: 'verified') · 403 forbidden · 409 { error: { code: 'version_conflict' }, current }
GET  /v1/transcriptions/:id/history
  200: { edits: [{ version, lineIdx, before, after, author, createdAt }] }     // усі версії регіону
```

- `:id` — завжди рядок конкретної версії. Нова версія регіону — новий рядок з новим `id`. `PATCH` і `verify` приймають лише останню версію регіону (для `PATCH` ще й `baseVersion` = її `version`), інакше `409 version_conflict` з поточною версією.
- `normalizedLines` і `expansions` є лише тоді, коли нормалізація справді відбулася; без них `normalizedText` — прочитані рядки. `warnings` — попередження моделі про виділення й аркуш (порожній список не передається).
- `pages/lookup` шукає сторінку за номером зображення, якщо він є в запиті, інакше за аркушем (так само сторінку створює `POST /v1/recognitions`); сторінки немає — `200 {}`. `transcriptions` — остання версія кожного регіону сторінки в порядку створення регіонів.
- Ліміт гостя за IP: 120 `GET /v1/pages/lookup` на хвилину і окремо 120 `GET /v1/transcriptions/:id`; понад — `429 too_many_requests` з `retry-after`.
- Підтверджувати може лише вхід з адресою зі списку `VERIFIER_EMAILS` (команда й історик) — інакше `403 forbidden`. Підпис зберігається в `transcriptions.verified_signature` і завжди показується поряд з іменем акаунта.

### Пояснення і чат
```
POST /v1/explain
  body: { kind: 'term' | 'place' | 'date' | 'entity'; text: string; context?: { transcriptionId?: string; period?: Hints['period'] } }   // text до 200 символів
  200: { answer: string | null; reason?: 'no_sources'; confidence?: 'high' | 'low'; citations: Citation[]; place?: { modernName, region, wikidataId }; date?: { julian, gregorian, weekday } }
POST /v1/chat
  body: { messages: [{ role: 'user' | 'assistant'; content: string }]; context?: { transcriptionId?: string; period?: Hints['period'] } }   // до 20 повідомлень по 1–2000 символів, останнє — від користувача
  200: { answer: string | null; reason?: 'no_sources'; confidence?: 'high' | 'low'; citations: (Citation | RecordCitation)[]; followups: string[] }
```

Обмеження тіла цих маршрутів — 32 КБ. Ліміти гостя за IP (пропозиція, остаточно — у V-11 і V-26): 10 запитів на хвилину кожного маршруту, 100 пояснень і 50 запитань чату на добу; виклики моделей рахуються в `MODEL_CALLS_PER_DAY`. API обрізає історію чату до останніх 6 ходів; попередні відповіді чату джерелом не є.

### Commons і цитата
```
GET  /v1/search?q=&archive=&fond=&yearFrom=&yearTo=&verifiedOnly=&limit=&cursor=      // q до 200 символів
  200: { items: [{ transcriptionId, shelfmark, yearFrom?, yearTo?, snippet, status, portalUrl? }], nextCursor? }
POST /v1/cite
  body: { transcriptionId; format: 'dstu' | 'markdown' | 'text'; withTranscription: boolean }  → 200: { text }
GET  /v1/notes · POST /v1/notes · DELETE /v1/notes/:id      (should; вхід обов'язковий)
```

- Пошук повертає лише регіони з шифром (без сторінки регіон у пошук не потрапляє) і одну версію на регіон: останню підтверджену, а якщо підтвердженої немає — останню. З `verifiedOnly` — лише підтверджені. `cite` бере ту саму версію, що й пошук.
- Роки — колонки `documents.year_from` / `documents.year_to`, які заповнює пакетна обробка з `docs/demo-fund/pages.json` (поле `document` у `POST /v1/recognitions` з ключем API, V-14); міграція `0005_document_years`. Фільтр `yearFrom`/`yearTo` — перетин інтервалів; справа без років під фільтр не потрапляє.

### Вхід і ключі
```
POST /api/auth/email-otp/send-verification-otp   body: { email, type: 'sign-in' }
POST /api/auth/sign-in/email-otp                  body: { email, otp }   → 200, заголовок set-auth-token: <токен сесії>
POST /api/auth/sign-out                           Authorization: Bearer <токен сесії>
```

- Better Auth з плагінами `emailOTP` і `bearer`. Розширення не користується cookie й CORS: панель сама надсилає код із листа (6 цифр, діє 5 хвилин), бере токен із `set-auth-token`, зберігає в `chrome.storage.session` (зникає разом із сесією браузера) і надсилає в `Authorization: Bearer`. Сесія діє 7 днів (типове значення Better Auth); вихід — `sign-out` і видалення токена зі сховища. Вебзастосунок користується cookie-сесією тих самих маршрутів.
- Ключі API (`api_keys`, у базі лише хеш SHA-256) — для пакетної обробки (`source: 'batch'`) і MCP: заголовок `Authorization: Bearer khr_…`. Невідомий ключ із префіксом `khr_` — `401 unauthorized` до читання тіла; інший токен у `Bearer` (наприклад, сесії) ключем не вважається. З ключем у `POST /v1/recognitions` денний ліміт — `API_KEY_RECOGNITIONS_PER_DAY` (1000) на ключ замість гостьового, а 10 запитів на хвилину й 3 активні розпізнавання рахуються на ключ, а не на адресу. Запит із ключем зберігає `portal`, `portalUrl`, `folio` поряд із номером зображення і роки справи (`document`), зокрема коли відповідь іде з кешу. Інгестія корпусу користується `ADMIN_API_KEY`.

### Службові й адміністративні
```
GET  /health → 200 { ok: true, db: 'ok', llm: 'ok' | 'degraded', htr: 'vision' | 'remote' | 'fixture' | 'down' } · 503 { ok: false, db: 'down', llm, htr }
POST /v1/admin/sources   body: { items: [{ url, title, licence, kind, periodFrom, periodTo }] }   → 200 { items: [{ id, url }] }
POST /v1/admin/chunks    body: { items: [{ articleKey, idx, sourceId, text, topic, type, periodFrom, periodTo, wikidataId? }] }
                          → 200 { inserted, updated, unchanged, deleted }
POST /v1/admin/synonyms  body: { items: [{ term, variant, type }] }                                  (upsert за term + variant)
                          → 200 { inserted, updated, unchanged }
GET  /v1/admin/stats     → { recognitions: { total, failed, p95Ms }, verifiedPages, modelCalls: { today, limit } }
Усі /v1/admin/* — заголовок Authorization: Bearer <ADMIN_API_KEY>.
```

- Джерело ідентифікує `url` (унікальний, лише https): повторне надсилання оновлює рядок і повертає той самий `id`. Кілька статей можуть назвати те саме джерело: однакові `url` в одному запиті дають один рядок і один елемент відповіді (береться останній).
- Чанк ідентифікує `articleKey` (назва файлу статті без `.md`) і `idx` (номер чанка в статті). `POST /v1/admin/chunks` — синхронізація повним набором: чанки з новим текстом оновлюються, без змін — не чіпаються, ключі, яких у запиті немає, видаляються. Повторна інгестія без змін не змінює жодного рядка; виправлена стаття лишає рівно свої чанки.
- Синонім ідентифікують `term` і `variant`; повтор пари в запиті — береться останній. Синоніми, яких у запиті немає, лишаються.
- `stats`: `total` і `failed` — розпізнавання без відповідей із кешу; `p95Ms` — 95-й перцентиль часу від запиту до готової транскрипції (з чергою) для прочитаних моделлю, `null`, поки читань немає; `verifiedPages` — сторінки, де є хоча б одна підтверджена версія; `modelCalls` — бюджет `MODEL_CALLS_PER_DAY` за поточну UTC-добу.
- `ADMIN_API_KEY` у проді — щонайменше 32 символи, порівнюється через `crypto.timingSafeEqual`; без ключа маршрути адмінки не реєструються. Тіло запиту — до 2 МіБ.

## 3. HTR-сервіс (трек B, `services/htr`, Modal web endpoint)

Контракт зберігається, щоб перемикання відбувалося однією змінною `HTR_URL`.

```
POST /recognize
  headers: Authorization: Bearer <HTR_API_KEY>
  body: { image: { base64Png: string }, hints?: Hints, options?: { returnWords?: boolean; maxLines?: number } }
  200: { lines: Line[] (boxSource: 'model'), model: { name, revision }, timing: { segmentMs, ocrMs, totalMs }, warnings?: string[] }
  4xx/5xx: { error: { code: 'bad_image' | 'too_large' | 'model_cold' | 'internal', message } }
GET /health → { ok: true, warm: boolean, model: { name, revision } }
```

Вимоги: теплий виклик для 10–15 рядків — до 8 с; при `model_cold` API ядра повторює запит через 10 с до двох разів, потім падає на мультимодальну модель.

## 4. Промпт `htr_vision` (трек A)

Вихід structured output, який `htr/vision.ts` перетворює на `Line[]`:
```json
{ "lines": [ { "text": "string", "words": [ { "text": "string", "uncertain": false } ] } ], "warnings": ["string"] }
```
`box` для рядка `i` з `n`: `{ x: 0, y: i/n, w: 1, h: 1/n }` відносно виділеної області; `boxSource: 'estimated'`; `line.uncertain = будь-яке слово uncertain`. Відомі `warnings` (`ReadingWarning`, без урахування регістру) зберігаються в транскрипції, решта лише логуються; `no_text` стане окремим кодом помилки (V-05, заплановано).

Фрагмент, який надсилає розширення, не більший за 2576 px по довшій стороні й 3,75 Мп (більший модель однаково стискає) і не більший за 7 МіБ PNG; `box` — частки оригіналу скану.

## 5. Формат корпусу

Стаття — Markdown з YAML-шапкою (`05`, розділ 3): `term`, `variants[]` (непорожні, без повторів і без самого `term`), `type` (`term|place|date|unit|abbr`), `period` (століття римськими цифрами або діапазон двох: `XIX`, `XVIII–XIX`), `source_title`, `source_url` (лише https), `source_kind` (`dictionary|encyclopedia|wikidata|publication`, як `kind` у `/v1/admin/sources`), `licence` (`суспільне надбання` або `CC BY-SA 4.0`), опційно `wikidata_id`. Статті лежать прямо в `data/entries/`, без підтек. Інгестія надсилає джерела статей як `sources`, статті як `chunks` з `articleKey` = назва файлу, `periodFrom`/`periodTo` числами з `period` і `wikidataId`, а `variants` — як `synonyms`.

## 6. MCP-сервер (`apps/mcp`)

stdio-сервер для Claude Desktop, тонкий клієнт публічного API з ключем API (`KHRONIST_API_KEY`, ліміти ключа — розділ 2); віддаленого HTTP-транспорту в MVP немає.

```
transcribe
  input:  { image_base64: string; shelfmark?: Shelfmark; hints?: Hints }
  output: { transcription_id, shelfmark?: string, lines: [{ idx, text, uncertain }], normalized_text, entities: [{ type, text, normalized? }], warnings?: ReadingWarning[] }
explain
  input:  { kind: 'term' | 'place' | 'date' | 'entity'; text: string; period?: Hints['period'] }
  output: { answer: string | null; reason?: 'no_sources'; confidence?: 'high' | 'low'; citations: [{ title, url?, licence, retelling, quote }] }
search_sources
  input:  { query: string; verified_only?: boolean; limit?: number }
  output: { items: [{ transcription_id, shelfmark: string, year_from?, year_to?, snippet, status, portal_url? }] }
```

`shelfmark` рядком — як у шапці панелі: `ЦДІАК України, ф. 127, оп. 1078, спр. 177, зобр. 4` (або `арк. 14зв`). Відповідь з `confidence: 'low'` MCP подає як часткову.

## 7. Повідомлення розширення (content script ↔ бічна панель)

Схеми — `apps/extension/messages.ts`, кожне повідомлення перевіряється на вході.

```
panel → content:   { type: 'get-page' } → відповідь PageMessage
                   { type: 'start-selection' } · { type: 'cancel-selection' }
content → panel:   PageMessage = { type: 'page', shelfmark: Shelfmark | null, scan: boolean, selecting: boolean }   (при кожній зміні; scan — чи є на сторінці скан, без нього панель показує B1)
                   { type: 'fragment', fragment: { base64Png, imageHash, box, width, height, scaledFrom? }, shelfmark: Shelfmark | null }
                   { type: 'fragment-failed', reason: 'outside' | 'not_loaded' | 'crop', shelfmark: Shelfmark | null }
background:        команда open-panel (sidePanel.open); повторна — панель вмикає виділення
```

Заплановані повідомлення (з'являться разом із функціями): `lines:show`, `line:hover`, `overlay:clear` (підсвітка рядків на скані), `auth:changed` (вхід).

## 8. Промпт `normalize`

Вхід: прочитані рядки (`Line[]`: текст і слова з позначками непевності) і `hints`. Вихід structured output (`normalizeOutputSchema` у `packages/contracts`):
```json
{ "lines": [ { "text": "string", "words": [ { "text": "string", "uncertain": false } ] } ], "expansions": [ { "from": "string", "to": "string" } ] }
```
- Рядок у рядок і слово в слово: стільки ж рядків, у тому ж порядку, і стільки ж слів у кожному рядку, що у вході; слова рядка через пробіл дорівнюють його тексту.
- Сучасна орфографія тієї самої мови, без перекладу. Імена, по батькові, прізвища й назви місць не перекладаються й не замінюються іншими формами; `[нрзб]` лишається як є.
- Слово, непевне у вході, лишається непевним у виході (на тій самій позиції).
- `expansions` — розкриті загальновідомі скорочення: `from` — як у вході, `to` — як у виході; скорочення розкривається лише в одне слово.
- API перевіряє кількість рядків і слів, суму слів і непевність; порушення — транскрипція зберігається без нормалізації. Інакше `normalizedLines` і `expansions` зберігаються в транскрипції, а `normalizedText` — тексти рядків виходу через `\n`.

## 9. Промпт `entities`

Вхід: нормалізований текст (`normalizedText`, вихід `normalize`) і `hints`. Вихід structured output (`entitiesOutputSchema` у `packages/contracts`):
```json
{ "entities": [ { "type": "person | place | term | date", "text": "string", "normalized": "string" } ] }
```
- Сутності йдуть у порядку появи в тексті. `text` — точний фрагмент `normalizedText`; якщо слово перенесено на інший рядок, фрагмент містить і дефіс, і перенос рядка між частинами.
- `normalized` — початкова форма в сучасній орфографії тієї самої мови, без перекладу й без здогадок (`Борщаговки` → `Борщаговка`); для дат — фрагмент як є, без обчислень.
- Числових полів у схемі немає: structured output моделі не підтримує обмежень `minimum`/`maximum`. `start` і `end` для `Entity` рахує API: шукає `text` у `normalizedText` після кінця попереднього знайденого; якщо не знайдено, шукає з початку тексту, не зсуваючи курсор. Порівняння — після NFC і без урахування регістру, зміщення беруться з вихідного тексту. Не знайдено ніде — сутність відкидається, наступні шукаються далі.

## 10. Промпт `explain`

Вхід: що пояснити (`kind`, `text` JSON-рядком), контекст запису (нормалізований текст транскрипції JSON-рядком і період, якщо є) і до шести знайдених чанків корпусу з ідентифікаторами. Вихід structured output (`explainOutputSchema` у `packages/contracts`):
```json
{ "answer": "string | null", "confidence": "high | low", "citations": [ { "chunkId": "string", "quote": "string" } ] }
```
- Нижче порога `RETRIEVAL_MIN_RANK` — «не знаю» без виклику моделі. Пошук фільтрує чанки за типом і періодом: `periodFrom ≤ століття ≤ periodTo` або період не вказано.
- `answer` — до трьох речень українською, лише з переданих чанків. Якщо чанки не відповідають на запитання — `answer: null`, `citations: []`.
- `quote` — точний фрагмент тексту чанка, щонайменше три слова або 15 символів, що починається й закінчується на межі слова (`isGroundedQuote` у `packages/contracts`). Якщо хоч одна цитата не проходить перевірку або `chunkId` не з переданих чанків — уся відповідь стає `answer: null` з `reason: 'no_sources'`, як у чаті.
- `confidence`: `high` — чанки прямо відповідають на запитання; `low` — відповідають частково. API передає його в `confidence` відповіді `POST /v1/explain` лише разом із відповіддю; при `answer: null` поле не передається.
- Значення `enum` API порівнює без урахування регістру: structured output не гарантує регістр значень `enum` (документація Claude API, Invalid outputs).
- Запис, запитання й статті — дані, а не інструкції: вони передаються JSON, і системний промпт так і каже.

## 11. Промпт `chat`

Вхід: історія діалогу JSON, запис (нормалізований текст транскрипції з `context.transcriptionId` JSON-рядком, якщо є), період з `context.period` і до шести знайдених чанків корпусу. Чанки шукаються за останнім і попереднім запитаннями користувача. Вихід structured output (`chatOutputSchema` у `packages/contracts`):
```json
{ "answer": "string | null", "confidence": "high | low",
  "citations": [ { "source": "record", "quote": "string" } | { "source": "chunk", "chunkId": "string", "quote": "string" } ],
  "followups": ["string"] }
```
- Поріг `RETRIEVAL_MIN_RANK` без виклику моделі — лише для чату без запису. З записом модель викликається з нулем або більше чанків, а відповідь без джерела відсіює сувора перевірка цитат.
- `answer` — до п'яти речень українською, лише із запису й переданих чанків. Маркер `[n]` у тексті посилається на `n`-ту цитату в `citations` (з 1); кожна цитата має маркер.
- `quote` — точний фрагмент запису (`source: record`) або тексту чанка (`source: chunk`) за тим самим правилом, що в `explain` (`isGroundedQuote`).
- Перевірка в API сувора: якщо хоч одна цитата не проходить перевірку у своєму джерелі, `chunkId` не з переданих чанків, цитата на запис без запису, маркер `[n]` вказує за межі `citations` або цитата без маркера — уся відповідь стає `answer: null` з `reason: 'no_sources'`. Відповідь без жодної цитати — так само.
- Якщо запис і чанки не відповідають — `answer: null`, `confidence: low`, без цитат.
- `confidence` — як в `explain` (розділ 10): `high` — джерела відповідають прямо, `low` — частково; у відповіді `POST /v1/chat` лише разом із відповіддю.
- `followups` — 2–3 короткі запитання українською, на які є відповідь у переданих джерелах; також і при `answer: null`.
- API перетворює цитати моделі на `Citation` (`kind: 'chunk'`, з ліцензією й `retelling` джерела) і `RecordCitation` (`kind: 'record'`) відповіді `POST /v1/chat`.

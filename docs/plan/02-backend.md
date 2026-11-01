# 02 · Бекенд: API, база даних, фонові задачі, авторизація, пошук, MCP

Відповідальний: Владислав. Усе в `apps/api` і `apps/mcp`, спільні схеми — у `packages/contracts`. Один процес API без окремого воркера, без Redis, без векторної БД.

## 1. Стек і версії (звірено 1 листопада 2026)

| Частина | Вибір | Версія | Чому |
| --- | --- | --- | --- |
| Runtime | Node.js | 24 LTS | збігається з `engines` сайту |
| HTTP | Fastify | 5.x | швидкий, плагіни для SSE, swagger, rate limit; мінімум магії |
| Валідація | Zod + fastify-type-provider-zod | zod 4.x, провайдер 7.x | одні схеми для рантайму, типів і OpenAPI |
| OpenAPI | @fastify/swagger | 9.x | специфікацію читають розширення, веб, MCP і ML-команда |
| ORM | Drizzle ORM + drizzle-kit | 0.45 / 0.31 | SQL-перший, міграції файлами, `tsvector` через `customType` |
| Драйвер БД | postgres (postgres.js) | 4.x | найшвидший для Node |
| Фонові задачі | p-queue | 9.x | черга в процесі з обмеженням паралельності; стан — у таблиці `recognitions` |
| Ліміти для гостей | @fastify/rate-limit | 10.x | в пам'яті процесу; одного інстансу достатньо |
| Авторизація | Better Auth | 1.7.x | magic link, сесії, адаптер Drizzle, маршрути `/api/auth/*` |
| Листи | Resend | SDK 6.x | magic link; безкоштовно до 3 000 листів на місяць |
| LLM | @anthropic-ai/sdk, @google/genai | 1.x / 2.x | обидва з підтримкою зображень; за єдиним адаптером `LlmProvider` |
| MCP | @modelcontextprotocol/sdk | 1.32.x | сервер зі stdio і Streamable HTTP |
| Логи | pino | 10.x | JSON-логи, вбудований у Fastify |
| Тести | Vitest | 5.x | юніт і інтеграційні проти тестової БД |

Усі версії перевіряти в npm перед встановленням: пакети оновлюються швидко.

## 2. Структура `apps/api`

```
apps/api/
├── src/
│   ├── server.ts            запуск Fastify, запуск черги задач
│   ├── app.ts               buildApp(): плагіни, хуки, обробка помилок
│   ├── config.ts            читання env через Zod, падіння при відсутності обов'язкових
│   ├── db/
│   │   ├── schema.ts        таблиці Drizzle
│   │   ├── client.ts        підключення postgres.js
│   │   └── migrations/      згенеровані drizzle-kit
│   ├── auth/                Better Auth: конфіг, адаптер Drizzle, Resend
│   ├── routes/
│   │   ├── recognitions.ts  POST /v1/recognitions, GET /v1/recognitions/:id, SSE
│   │   ├── pages.ts         пошук аркуша за шифром, уже прочитане
│   │   ├── transcriptions.ts редагування рядків, підтвердження, історія
│   │   ├── explain.ts       пояснення терміна, топоніма, дати
│   │   ├── chat.ts          діалог із контекстом аркуша
│   │   ├── search.ts        публічний пошук Commons
│   │   ├── cite.ts          архівна цитата
│   │   ├── admin.ts         інгестія корпусу і словника (API-ключ адміністратора)
│   │   └── health.ts
│   ├── services/
│   │   ├── htr/             index.ts (вибір за env), vision.ts (мультимодальна модель), remote.ts (HTR-сервіс треку B)
│   │   ├── llm/             LlmProvider: anthropic.ts, gemini.ts, index.ts (вибір і резерв)
│   │   ├── retrieval.ts     повнотекстовий пошук по корпусу з розширенням запиту словником варіантів
│   │   ├── calendar.ts      юліанський → григоріанський, день тижня, «від створення світу»
│   │   ├── citation.ts      форматування архівної цитати (ДСТУ, Markdown, текст)
│   │   └── commons.ts       збереження, версії, статуси, підвантаження прочитаного
│   ├── jobs/
│   │   ├── queue.ts         p-queue, concurrency з env, відновлення після рестарту
│   │   ├── recognize.ts     задача: читання → нормалізація → сутності → дати → збереження → події
│   │   └── events.ts        EventEmitter за recognitionId → SSE
│   └── lib/                 sse.ts, hash.ts, errors.ts, image.ts (перевірка розміру, конвертація в PNG)
├── test/
├── drizzle.config.ts
└── package.json
```

## 3. Схема бази даних

Усі ідентифікатори — UUID v7. Часові мітки `timestamptz`. Координати — частки 0…1 від ширини й висоти зображення.

```
users, sessions, accounts, verifications      (Better Auth, генеруються CLI)

documents             id, archive, fond, opys, sprava, title, portal, portal_url, created_by, created_at
                      unique(archive, fond, opys, sprava)
pages                 id, document_id, folio, source_url, image_hash, width, height, created_at
                      unique(document_id, folio)
regions               id, page_id, x, y, w, h, image_hash, created_by, created_at
recognitions          id, region_id, status (queued|reading|normalizing|done|failed), source (extension|web|mcp|batch),
                      transcription_id, error_code, error_message, attempts, started_at, finished_at, created_at
transcriptions        id, region_id, version, status (draft|verified|disputed),
                      raw_text, normalized_text, reader (назва моделі або сервісу), author_id, verified_by, verified_at, created_at
transcription_lines   id, transcription_id, idx, text, x, y, w, h, box_source (model|estimated), confidence
line_words            id, line_id, idx, text, uncertain boolean, confidence
entities              id, transcription_id, type (person|place|term|date), text, normalized,
                      wikidata_id, start, end, extra jsonb       (extra: дата нового стилю, сучасна назва)
edits                 id, transcription_id, line_idx, before, after, author_id, created_at
sources               id, title, url, licence, kind (dictionary|encyclopedia|wikidata|publication), period
chunks                id, source_id, text, text_hash, topic, type (term|place|date|unit|abbr), period, tsv tsvector
synonyms              id, term, variant, type                       (словник варіантів написання, з ML-команди)
notes                 id, user_id, transcription_id, excerpt, note, citation, created_at   (should)
api_keys              id, user_id, key_hash, name, created_at     (для MCP, скриптів, інгестії)
```

Розширення Postgres: `pg_trgm`. Індекси: `chunks.tsv` — GIN; `chunks.text` і `synonyms.variant` — GIN `gin_trgm_ops`; `transcriptions(region_id, version desc)`; `entities(normalized)` — GIN `gin_trgm_ops` для прізвищ із варіантами написання; `regions(image_hash)` для кешу; `recognitions(status)` для відновлення.

`tsv` заповнюється тригером або при вставці: `to_tsvector('simple', text || ' ' || варіанти з synonyms для термінів цього чанка)`. Словника `ukrainian` у стандартному Postgres немає, тому `simple` плюс словник варіантів — свідомий вибір; стемінг не потрібен на 200 статтях.

## 4. Авторизація

Better Auth із плагіном magic link. Для вебу — cookie-сесія; для розширення — та сама сесія через `credentials: 'include'` із дозволеним origin `chrome-extension://<id>` у CORS, резервно — bearer-токен сесії. Для MCP, інгестії та скриптів — `api_keys` з хешем, заголовок `Authorization: Bearer`.

Читання, пояснення й чат доступні без входу (ліміт для гостей: 60 розпізнавань і 60 запитань на день на IP через `@fastify/rate-limit`). Підтвердження, редагування й нотатник — лише з входом. Підпис підтвердження — `users.name` або псевдонім.

## 5. Читання фрагмента: фонова задача в процесі

```
POST /v1/recognitions
  → перевірка кешу: regions.image_hash + шифр → якщо є transcription, 201 { status: "cached", transcriptionId }
  → інакше створюємо region, recognitions(status=queued), ставимо задачу в p-queue
  → 201 { recognitionId, status: "queued" }

job recognize(recognitionId):
  1. status=reading;   htr.read(image, hints)         → рядки зі словами й позначками непевності;
                                                         box: від HTR-сервісу — реальний; від мультимодальної моделі — рівні смуги, box_source=estimated
  2. status=normalizing; llm.normalize(lines, context) → normalized_text, розкриті скорочення
  3. llm.extractEntities(normalized, lines)            → entities зі спанами
  4. calendar.convert(dates)                           → extra.newStyle, день тижня
  5. збереження transcription, lines, words, entities; transcriptions.reader = назва моделі або сервісу
  6. status=done; події через EventEmitter: progress, line, done | failed

GET /v1/recognitions/:id/events  (SSE): події з EventEmitter, heartbeat кожні 15 с; при підключенні — поточний стан
GET /v1/recognitions/:id          поточний стан для повторного відкриття панелі
```

`htr/index.ts` обирає реалізацію за env: `HTR_URL` порожній → `vision.ts` (мультимодальна модель за промптом `htr_vision` з `packages/prompts`, structured output); заданий → `remote.ts` за контрактом `07`, розділ 3, з однією спробою `vision.ts` при помилці. Так ML-команда вмикає трек B однією змінною середовища без змін у коді.

Таймаути: читання 30 с, нормалізація 20 с. При помилці основної моделі — одна спроба резервної; при помилці резервної — `failed` з кодом `read_failed`, панель показує стан E3. Паралельність черги — `JOBS_CONCURRENCY` (стартово 4). При рестарті процесу задачі зі статусом `queued`/`reading`/`normalizing` старші за 2 хв позначаються `failed` з кодом `restarted`; клієнт пропонує повторити.

## 6. Мовна модель: єдиний адаптер

```ts
interface LlmProvider {
  complete(input: {
    system: string
    messages: Message[]              // content може містити { type: 'image', mediaType: 'image/png', base64 }
    schema?: ZodSchema
    maxTokens: number
  }): Promise<{ text: string; json?: unknown; usage: Usage }>
}
```

`index.ts` обирає Anthropic (`LLM_MODEL_PRIMARY`; актуальну назву моделі із зором звірити в документації Anthropic перед стартом) і при помилці або перевищенні ліміту переключається на Gemini (`LLM_MODEL_FALLBACK`). Для читання рукопису може бути окрема пара `HTR_MODEL_PRIMARY` / `HTR_MODEL_FALLBACK`: ML-команда обирає їх за CER 8 листопада. Промпти беруться з `packages/prompts`. Structured output — через JSON-схему з Zod; відповідь валідується, при невалідному JSON — одна повторна спроба.

Правило чесності реалізоване кодом: пояснення й відповіді чату повертають `citations: [{ chunkId, sourceId }]`; якщо масив порожній або посилання на неіснуючі чанки, API повертає `answer: null, reason: "no_sources"`, і клієнт показує «У довідковому корпусі немає відповіді».

## 7. Пошук по корпусу (retrieval)

`retrieval.ts`: запит → розширення словником варіантів (`synonyms`) → `websearch_to_tsquery('simple', …)` по `chunks.tsv` з `ts_rank` + `similarity()` по `chunks.text` для варіантів написання, яких немає у словнику → злиття, top-6 у промпт. Фільтри: `type` для пояснення топоніма або дати; `period` збігається або порожній. Поріг: якщо найкращий `ts_rank` нижчий за `RETRIEVAL_MIN_RANK` (стартово 0,05, підбирає ML-команда на `eval/qa.jsonl`), відповідь — «не знаю» без виклику LLM.

## 8. Пошук Commons

`GET /v1/search?q=Коваленко Борщагівка&verifiedOnly=true` → `similarity()` по `entities.normalized` і повнотекст `to_tsvector('simple')` по `transcriptions.normalized_text` → аркуші з фрагментом, роком, статусом, шифром і посиланням на портал. Імена й топоніми шукаються лексично з варіантами написання через `synonyms` типу `place` і `pg_trgm`.

## 9. MCP-сервер (`apps/mcp`)

Тонкий адаптер над REST API без власної логіки. Три інструменти: `transcribe`, `explain`, `search_sources`. Транспорт: stdio-бінарник для Claude Desktop (основний для демо) і Streamable HTTP на Railway (`/mcp`) для віддалених клієнтів. Авторизація — API-ключ. Логуються назва інструменту й тривалість, без вмісту зображень. Для демо підготувати `claude_desktop_config.json` зі шляхом до бінарника й ключем.

## 10. Тести

- Юніт: `calendar.ts` (таблиця дат), `citation.ts`, парсер відповіді LLM, розширення запиту словником, перевірка `citations`.
- Інтеграційні: маршрути проти тестової Postgres у Docker (`khronist_test`), LLM замокана фікстурами з реальних відповідей у `test/fixtures`.
- Контрактні: згенерований OpenAPI порівнюється зі схемами `packages/contracts` у CI.

## 11. Порядок робіт для Владислава

| Дата | Що |
| --- | --- |
| 2–3 лист | дослідження порталу, приватний репозиторій з планом і CLAUDE.md |
| Чт 5 | скаффолд монорепо, `packages/contracts`, CI |
| Пт 6 | схема БД, міграції, Compose, `/health`, Better Auth + Resend локально |
| Сб 7 | `POST /v1/recognitions` з фікстурним читанням, p-queue, SSE, кеш за хешем |
| Вт 10 | `LlmProvider` з резервом, `htr/vision.ts` за промптом ML-команди, `normalize`, `entities`, `calendar` |
| Ср 11 | transcriptions: редагування, підтвердження, історія; `pages/lookup`; деплой Railway prod |
| Чт 12 | `retrieval.ts`, `POST /v1/explain`, `POST /v1/admin/*` для інгестії |
| Пн 16 | скрипт пакетної обробки, E4 конфлікт правок (оптимістична версія) |
| Вт 17 | `POST /v1/chat`, `POST /v1/cite` |
| Ср 18 | `GET /v1/search`, `apps/mcp`, конфіг Claude Desktop |
| Чт 19 | швидкість, логи, п'ять прогонів |

Дні 8–9 і 13–15 — фронтенд (див. `03-frontend.md`).

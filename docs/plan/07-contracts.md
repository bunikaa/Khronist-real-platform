# 07 · Контракти між частинами

Єдине джерело правди на межах: бекенд ↔ клієнти, бекенд ↔ HTR-сервіс (трек B), бекенд ↔ інгестія корпусу, MCP ↔ бекенд. Реалізуються як Zod-схеми в `packages/contracts` (TypeScript) і Pydantic-моделі в `services/*/schemas.py` (Python). Зміна контракту — спочатку PR у цей документ і в `packages/contracts`, потім код.

Спільні правила: JSON, UTF-8; ідентифікатори — UUID; час — ISO 8601 UTC; координати — частки 0…1 від ширини й висоти зображення (`x`, `y` — лівий верхній кут); помилки — `{ "error": { "code": "snake_case", "message": "людською мовою українською" } }`.

## 1. Спільні типи

```ts
Shelfmark = { archive: string; fond: string; opys: string; sprava: string; folio?: string; image?: number; portal?: 'archium' | 'own'; portalUrl?: string }   // потрібне хоча б одне з folio, image
Box = { x: number; y: number; w: number; h: number }
Word = { text: string; uncertain: boolean; confidence?: number }            // confidence лише від HTR-сервісу
Line = { idx: number; text: string; box: Box; boxSource: 'model' | 'estimated'; uncertain: boolean; words: Word[] }
Entity = { type: 'person' | 'place' | 'term' | 'date'; text: string; start: number; end: number; normalized?: string; wikidataId?: string; extra?: Record<string, unknown> }
Citation = { chunkId: string; sourceId: string; title: string; url?: string; quote: string }
TranscriptionStatus = 'draft' | 'verified' | 'disputed'
RecognitionStatus = 'queued' | 'reading' | 'normalizing' | 'done' | 'failed'
```

## 2. Ядро API (`apps/api`, префікс `/v1`)

### Розпізнавання
```
POST /v1/recognitions
  body: { shelfmark?: Shelfmark; image: { base64Png: string }; box?: Box; imageHash: string; source: 'extension' | 'web' | 'mcp' | 'batch'; hints?: Hints }
  201: { recognitionId, status: 'queued' | 'cached', transcriptionId?: string }
GET  /v1/recognitions/:id
  200: { recognitionId, status: RecognitionStatus, transcription?: Transcription, error?: { code, message } }
GET  /v1/recognitions/:id/events      text/event-stream
  events: progress { status } · line { line: Line } · done { transcriptionId } · failed { code, message }
  codes: read_failed · normalize_failed · save_failed · restarted · bad_image · too_large
  помилки POST: 400 bad_request · 400 bad_image · 413 too_large · 429 too_many_requests · 503 reader_unavailable
Hints = { language?: 'uk' | 'ru' | 'church-slavonic' | 'pl'; period?: '17' | '18' | '19' | '20'; documentType?: 'metric' | 'revision' | 'court' | 'other' }
```

### Аркуші й транскрипції
```
GET  /v1/pages/lookup?archive&fond&opys&sprava&folio&image
  200: { page?: { id, shelfmark, transcriptions: TranscriptionSummary[] } }
GET  /v1/transcriptions/:id
  200: Transcription = { id, regionId, shelfmark?, box, version, status, lines: Line[], normalizedText, entities: Entity[], reader, author?: { name }, verifiedBy?: { name }, verifiedAt?, createdAt }
PATCH /v1/transcriptions/:id/lines          (вхід обов'язковий)
  body: { baseVersion: number; lines: [{ idx, text }] }
  200: Transcription (нова версія) · 409 { error: { code: 'version_conflict' }, current: Transcription }   → стан E4
POST /v1/transcriptions/:id/verify          (вхід обов'язковий)
  body: { signature?: string }        → 200: Transcription (status: 'verified')
GET  /v1/transcriptions/:id/history
  200: { edits: [{ lineIdx, before, after, author, createdAt }] }
```

### Пояснення і чат
```
POST /v1/explain
  body: { kind: 'term' | 'place' | 'date' | 'entity'; text: string; context?: { transcriptionId?: string; period?: string } }
  200: { answer: string | null; reason?: 'no_sources'; citations: Citation[]; place?: { modernName, region, wikidataId }; date?: { julian, gregorian, weekday } }
POST /v1/chat
  body: { messages: [{ role: 'user' | 'assistant'; content: string }]; context?: { transcriptionId?: string } }
  200: { answer: string | null; reason?: 'no_sources'; citations: Citation[]; followups: string[] }
```

### Commons і цитата
```
GET  /v1/search?q=&archive=&fond=&yearFrom=&yearTo=&verifiedOnly=&limit=&cursor=
  200: { items: [{ transcriptionId, shelfmark, year?, snippet, status, portalUrl? }], nextCursor? }
POST /v1/cite
  body: { transcriptionId; format: 'dstu' | 'markdown' | 'text'; withTranscription: boolean }  → 200: { text }
GET  /v1/notes · POST /v1/notes · DELETE /v1/notes/:id      (should; вхід обов'язковий)
```

### Службові й адміністративні
```
GET  /health → 200 { ok: true, db: 'ok', llm: 'ok' | 'degraded', htr: 'vision' | 'remote' | 'fixture' | 'down' } · 503 { ok: false, db: 'down', llm, htr }
/api/auth/*  Better Auth (magic link: POST /api/auth/sign-in/magic-link { email }, GET /api/auth/magic-link/verify?token)
POST /v1/admin/sources   body: { items: [{ id?, title, url, licence, kind, period }] }
POST /v1/admin/chunks    body: { items: [{ sourceId, text, textHash, topic, type, period }] }       (upsert за textHash)
POST /v1/admin/synonyms  body: { items: [{ term, variant, type }] }                                (upsert)
GET  /v1/admin/stats     → { recognitions: { total, failed, p95Ms }, verifiedPages, tokens: { input, output } }
Усі /v1/admin/* — заголовок Authorization: Bearer <ADMIN_API_KEY>.
```

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
`box` для рядка `i` з `n`: `{ x: 0, y: i/n, w: 1, h: 1/n }` відносно виділеної області; `boxSource: 'estimated'`; `line.uncertain = будь-яке слово uncertain`.

## 5. Формат корпусу

Стаття — Markdown з YAML-шапкою (`05`, розділ 3): `term`, `variants[]`, `type` (`term|place|date|unit|abbr`), `period`, `source_title`, `source_url`, `source_kind` (`dictionary|encyclopedia|wikidata|publication`, як `kind` у `/v1/admin/sources`), `licence`, опційно `wikidata_id`. Інгестія відправляє джерела статей як `sources`, статті як `chunks` із `textHash = sha256(text)` і `variants` як `synonyms`.

## 6. MCP-сервер (`apps/mcp`)

```
transcribe
  input:  { image_base64: string; shelfmark?: Shelfmark; hints?: Hints }
  output: { transcription_id, lines: [{ idx, text, uncertain }], normalized_text, entities }
explain
  input:  { kind: 'term' | 'place' | 'date' | 'entity'; text: string; period?: string }
  output: { answer: string | null; citations: [{ title, url, quote }] }
search_sources
  input:  { query: string; verified_only?: boolean; limit?: number }
  output: { items: [{ transcription_id, shelfmark: string, year?, snippet, status, portal_url }] }
```

## 7. Події розширення (внутрішній контракт content script ↔ side panel)

```
content → panel:   page:detected { shelfmark, imageAvailable }, selection:done { box, base64Png, imageHash }, selection:cancel
panel → content:   selection:start, lines:show { lines: Line[], tone }, line:hover { idx | null }, overlay:clear
background:        hotkey:toggle, auth:changed
```

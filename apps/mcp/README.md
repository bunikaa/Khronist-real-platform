# apps/mcp

MCP-сервер Хроніста для Claude Desktop: тонкий клієнт публічного API, транспорт stdio, віддаленого HTTP-транспорту немає. Контракт інструментів — `docs/plan/07-contracts.md`, розділ 6.

## Інструменти

- `transcribe` — читає PNG-фрагмент скану: `POST /v1/recognitions` з `source: mcp`, далі `GET /v1/recognitions/:id` кожні 2 с, доки читання не завершиться (до 4 хвилин). Хеш зображення рахується від байтів PNG, тож повторний фрагмент приходить з кешу без викликів моделі. Відповідь — рядки з позначкою непевності, текст сучасною орфографією, сутності й попередження моделі; шифр — рядком, як у шапці панелі.
- `explain` — `POST /v1/explain`: пояснення терміна, топоніма, дати чи сутності лише з довідкового корпусу, з цитатами й ліцензією джерела. Без джерел — `answer: null` і `reason: no_sources`; відповідь з `confidence: low` позначається як часткова.
- `search_sources` — ще немає: інструмент з'явиться разом із `GET /v1/search` (V-30), до того сервер його не показує.

Помилки API доходять до Claude Desktop як помилка інструмента з кодом і текстом сервера.

## Запуск

Змінні:
- `KHRONIST_API_URL` — адреса API, типово `https://api.khronist.org`;
- `KHRONIST_API_KEY` — окремий ключ `khr_…` для MCP (V-14), видає Владислав: `railway ssh --service api -- pnpm --filter @khronist/api api-key:create "MCP demo"`. З ключем `transcribe` отримує ліміти ключа, без нього — ліміти гостя.

Node 24 запускає `src/server.ts` напряму, а `@khronist/contracts` знаходить через symlink workspace, тож сервер запускається з клонованого репозиторію після `pnpm install`. Конфіг Claude Desktop (`claude_desktop_config.json`), шлях — до свого клону:

```json
{
  "mcpServers": {
    "khronist": {
      "command": "node",
      "args": ["C:\\шлях\\до\\Khronist-real-platform\\apps\\mcp\\src\\server.ts"],
      "env": { "KHRONIST_API_KEY": "khr_…" }
    }
  }
}
```

Сервер пише в stdout лише повідомлення протоколу MCP.

## Перевірка

`pnpm --filter @khronist/mcp test` — перетворення відповідей API на вихід інструментів і цикл читання на підміненому `fetch`: кеш, очікування до `done`, `failed`, помилка API, час очікування.

# Розробка

Як запустити проєкт локально, чим перевіряти зміни й як розгортати. Про влаштування системи — [architecture.md](architecture.md), про змінні середовища — [configuration.md](configuration.md), про правила для авторів змін — [CONTRIBUTING.md](../CONTRIBUTING.md).

## Що потрібно встановити

| Інструмент | Версія | Для чого |
| --- | --- | --- |
| Node.js | 24 або новіша | увесь TypeScript-код (Node запускає `.ts` напряму) |
| pnpm | 12.16.1 (`npm install -g pnpm@12.16.1`) | залежності й команди монорепо |
| Docker | актуальна | локальний PostgreSQL 18 |
| uv | актуальна | лише для `services/knowledge` (Python 3.12) |
| Chrome | 116 або новіший | перевірка розширення |

У Windows uv ставиться командою `winget install astral-sh.uv`; після встановлення потрібно перезапустити термінал і редактор, інакше команди не з'являться в `PATH`.

## Перший запуск

Docker має бути запущений. Команди виконуються в корені репозиторію.

```sh
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm dev
```

У PowerShell замість `cp` — `Copy-Item .env.example .env`. `pnpm install` також вмикає git-хуки (`core.hooksPath=.githooks`).

Перевірка: `GET http://localhost:3000/health` повертає `{"ok":true,"db":"ok","llm":"degraded","htr":"fixture"}`.

- `htr: "fixture"`: у `.env.example` стоїть `LLM_FIXTURES=1`, тож читання фікстурне. Будь-яке зображення дає той самий демонстраційний текст, а виклики моделі не витрачаються.
- `llm: "degraded"`: не задано ключ API. Для роботи з фікстурами це нормально.

`pnpm dev` запускає через Turborepo API, розширення (WXT відкриває окремий Chrome) і вебзастосунок (`http://localhost:5173`). Усі вони ходять у локальний API, а не в прод.

### Справжнє читання замість фікстур

Задайте `ANTHROPIC_API_KEY` у `.env` і приберіть `LLM_FIXTURES=1`. Перед цим зітріть локальну базу, бо кеш віддає фікстурні транскрипції як справжні:

```sh
docker compose -f infra/docker-compose.yml down -v
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
```

Резервна модель вмикається змінними `HTR_MODEL_FALLBACK` і `GOOGLE_API_KEY`. Усі налаштування — в [configuration.md](configuration.md).

## Команди

З кореня репозиторію:

| Команда | Що робить |
| --- | --- |
| `pnpm dev` | запускає застосунки в режимі розробки |
| `pnpm lint` | перевіряє код через oxlint |
| `pnpm typecheck` | перевіряє типи в усіх пакетах |
| `pnpm test` | запускає тести vitest, Docker не потрібен |
| `pnpm build` | збирає пакети |
| `pnpm format` / `pnpm format:check` | форматує код через Prettier / перевіряє форматування |
| `pnpm db:generate` | створює міграцію зі змін у схемі |
| `pnpm db:migrate` | застосовує міграції |
| `pnpm --filter @khronist/api start` | запускає API без перезапуску при змінах |
| `pnpm --filter @khronist/api smoke` | перевіряє читання проти запущеного API з справжнім PostgreSQL |
| `pnpm --filter @khronist/api api-key:create "<хто користується>"` | випускає ключ API, друкує його один раз |
| `pnpm --filter @khronist/api readings:import` | імпортує готові прочитання демо-фонду (`--dry-run` лише показує, що буде записано) |
| `pnpm --filter @khronist/extension zip` | пакує розширення в архів |

`services/knowledge` має окремий набір (у теці сервісу):

```sh
uv sync --locked
uv run ruff check
uv run ruff format --check
uv run pytest
```

Інші скрипти сервісу (`scripts/ingest.py`, `eval/run_qa.py`, `eval/run_htr_eval.py`, `scripts/batch_recognize.py`) описано в [README сервісу](../services/knowledge/README.md).

## Тести

- `pnpm test` у `apps/api` не потребує Docker: схема перевіряється на вбудованому PGlite (WASM PostgreSQL) з тими самими міграціями й розширенням `pg_trgm`.
- PGlite не ловить усіх помилок справжнього драйвера, тому окремо є `smoke` проти запущеного API з PostgreSQL. У CI його запускає задача `runtime`.
- Розширення, вебзастосунок і MCP перевіряються vitest; інтерфейс розширення додатково перевіряють вручну в Chrome (збірка: `pnpm --filter @khronist/extension build`, тека `apps/extension/.output/chrome-mv3`).

## Міграції

Схема бази — `apps/api/src/db/schema.ts`. Після зміни схеми:

```sh
pnpm db:generate
pnpm db:migrate
```

Перевірте згенерований SQL у `apps/api/src/db/migrations` перед комітом. Drizzle не генерує `CREATE EXTENSION`, тому розширення `pg_trgm` створюється в першій міграції вручну. Нові міграції застосовуються на чистій базі й поверх попередньої схеми.

## Розгортання

API працює на Railway, конфігурація — `.railway/railway.ts`: збірка Railpack, міграції як pre-deploy (`pnpm db:migrate`), запуск `pnpm --filter @khronist/api start`, перевірка `/health`, домен `api.khronist.org`. Деплой `main` відбувається після зеленого CI. Секрети задаються в Railway, у репозиторій не потрапляють; список змінних — у [configuration.md](configuration.md).

Пакети workspace (`@khronist/contracts`) віддають сирий `.ts`, який Node запускає напряму лише через symlink workspace. Тому на хостингу:

- ставте залежності всього монорепо: `pnpm install --frozen-lockfile`;
- запускайте `pnpm --filter @khronist/api start`;
- не використовуйте `pnpm deploy` і не копіюйте `node_modules`: запуск зламається з `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`.

У `.ts` допустимий лише синтаксис, який стирається (без `enum`, `namespace`, параметрів-властивостей); це перевіряє опція `erasableSyntaxOnly`.

Вебзастосунок `apps/web` розгортається на Vercel (`app.khronist.org`); `pnpm --filter @khronist/web build` збирає його в теку `dist`. Розширення збирається й пакується локально (`pnpm --filter @khronist/extension zip`).

## CI

`.github/workflows/ci.yml`, три задачі:

| Задача | Що перевіряє |
| --- | --- |
| `check` | `pnpm install --frozen-lockfile`, `lint`, `format:check`, `typecheck`, `test`, `build` |
| `knowledge` | `uv sync --locked`, `ruff check`, `ruff format --check`, `pytest` у `services/knowledge` |
| `runtime` | PostgreSQL 18, `db:migrate`, запуск API, запит `/health`, `smoke` |

Локально те саме роблять git-хуки: `.githooks/pre-commit` запускає `lint`, `typecheck`, `test` (і перевірки `services/knowledge`, якщо в коміті є його файли), `.githooks/pre-push` забороняє прямий пуш у `main`.

## Типові проблеми

| Симптом | Причина | Що зробити |
| --- | --- | --- |
| `Cannot find package` після `git pull` | не встановлені нові залежності | `pnpm install` |
| `failed to connect to the docker API` | Docker не запущений | запустити Docker й повторити команду |
| порт 5432 зайнятий, контейнер не стартує | працює інший PostgreSQL | зупинити його |
| `/health` повертає 503 і `db: "down"` | база не запущена або неправильний `DATABASE_URL` | `docker compose -f infra/docker-compose.yml up -d`, перевірити `.env` |
| помилка про відсутню таблицю | не застосовані міграції | `pnpm db:migrate` |
| нові фрагменти дають 503, `htr: "down"` | немає `LLM_FIXTURES=1` і ключа моделі | задати `LLM_FIXTURES=1` або ключ у `.env` |
| коміт проходить без перевірок | хуки не ввімкнені | `pnpm install`, перевірити `git config core.hooksPath` (має бути `.githooks`) |
| `uv` не знайдено одразу після встановлення | термінал не бачить новий `PATH` | перезапустити термінал і редактор |
| на хостингу `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | використано `pnpm deploy` або копію `node_modules` | ставити все монорепо, запускати `pnpm --filter @khronist/api start` |

# Хроніст

AI-компаньйон для дослідників українських архівів: розширення Chrome читає рукописні скани на архівних порталах, пояснює терміни й дати з джерелами, а підтверджені людьми транскрипції потрапляють у відкритий шар Commons (CC BY 4.0).

Зараз у репозиторії працює API: https://api.khronist.org (Railway, опис інфраструктури — `.railway/railway.ts`). Розширення Chrome читає виділені фрагменти сканів у переглядачі ARCHIUM (`archium.cdiak.archives.gov.ua`) через бічну панель. `services/knowledge` містить довідковий корпус і оцінку читання. Вебзастосунок `apps/web` — публічний пошук у Commons; його ще не розгорнуто, адреса буде `app.khronist.org` (Vercel). MCP-сервера ще немає.

## Що потрібно встановити

| Інструмент       | Версія                                  | Для чого                                    |
| ---------------- | --------------------------------------- | ------------------------------------------- |
| Node.js          | 24 або новіша                           | увесь TypeScript-код                        |
| pnpm             | 12.16.1 (`npm install -g pnpm@12.16.1`) | залежності й команди                        |
| Docker Desktop   | будь-яка актуальна                      | локальний PostgreSQL 18                     |
| uv і Python 3.12 | актуальний uv                           | для `services/knowledge`                    |
| GitHub CLI       | необов'язково                           | PR із термінала                             |

У Windows uv і GitHub CLI ставляться так: `winget install astral-sh.uv` і `winget install GitHub.cli`. Після цього треба перезапустити термінал і редактор, інакше команд не буде в `PATH`.

## Перший запуск

Docker Desktop має бути запущений. Команди виконуються в корені репозиторію.

```sh
pnpm install
cp .env.example .env
docker compose -f infra/docker-compose.yml up -d
pnpm db:migrate
pnpm dev
```

У PowerShell замість `cp` працює `Copy-Item .env.example .env`.

Перевірка: `GET http://localhost:3000/health` повертає `{"ok":true,"db":"ok","llm":"degraded","htr":"fixture"}`.

- `htr: "fixture"`: читання фікстурне, бо в `.env.example` стоїть `LLM_FIXTURES=1`. Будь-яке зображення дає той самий демонстраційний текст, а гроші не витрачаються.
- `llm: "degraded"`: немає ключа API. Для роботи з фікстурами це нормально.

Розширення, запущене через `pnpm --filter @khronist/extension dev`, і вебзастосунок з `pnpm dev` (`http://localhost:5173`) ходять у цей локальний API, а не в прод. Для справжнього читання задайте `ANTHROPIC_API_KEY` і приберіть `LLM_FIXTURES=1`. Спершу зітріть локальну базу (`docker compose -f infra/docker-compose.yml down -v`, потім знову `up -d` і `pnpm db:migrate`), бо кеш віддає фікстурні транскрипції як справжні.

## Команди

| Команда            | Що робить                             |
| ------------------ | ------------------------------------- |
| `pnpm dev`         | запускає застосунки в режимі розробки |
| `pnpm lint`        | перевіряє код через oxlint            |
| `pnpm typecheck`   | перевіряє типи                        |
| `pnpm test`        | запускає тести, Docker не потрібен    |
| `pnpm format`      | форматує код через Prettier           |
| `pnpm format:check` | перевіряє форматування                |
| `pnpm db:generate` | створює міграцію зі змін у схемі      |
| `pnpm db:migrate`  | застосовує міграції                   |

## Структура

| Тека                 | Що там                                                    | Власник                |
| -------------------- | --------------------------------------------------------- | ---------------------- |
| `apps/api`           | API на Fastify 5 і Drizzle ([README](apps/api/README.md)) | Владислав              |
| `apps/extension`     | розширення Chrome на WXT ([README](apps/extension/README.md)) | Владислав |
| `apps/web`           | вебзастосунок: пошук у Commons ([README](apps/web/README.md)) | Владислав |
| `packages/ui`        | тема daisyUI і компоненти з Figma ([README](packages/ui/README.md)) | Владислав |
| `packages/contracts` | Zod-схеми й типи                                          | Владислав і ML-команда |
| `packages/prompts`   | промпти                                                   | ML-команда             |
| `packages/config`    | спільні налаштування                                      | Владислав              |
| `services/knowledge` | корпус, словник варіантів, оцінка читання ([README](services/knowledge/README.md)) | Анна і Катерина |
| `infra`              | локальний PostgreSQL                                      | Владислав              |
| `.railway`           | сервіс API і база на Railway                              | Владислав              |
| `docs`               | план, контекст, рішення                                   | уся команда            |

## Як долучитися

Правила роботи з гілками, комітами й PR, а також типові проблеми описані в [CONTRIBUTING.md](CONTRIBUTING.md). Контекст проєкту: [docs/project-context.md](docs/project-context.md), план: [docs/plan/README.md](docs/plan/README.md), контракти: [docs/plan/07-contracts.md](docs/plan/07-contracts.md), рішення: [docs/decisions.md](docs/decisions.md).

## Ліцензія

Код — [Apache-2.0](LICENSE). Підтверджені транскрипції Commons публікуються під CC BY 4.0.

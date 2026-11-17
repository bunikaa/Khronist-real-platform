# 06 · Інфраструктура, середовища, вартість

Відповідальний: Владислав; Modal (лише трек B) налаштовує ML-команда.

## 1. Хостинг: що й де

| Компонент | Де | Тариф | Орієнтовна вартість за листопад |
| --- | --- | --- | --- |
| API (Fastify, один процес із фоновими задачами) | Railway, сервіс `api` | Hobby, оплата за використання | $5–8 |
| PostgreSQL 18 | Railway Postgres | — | $2–5 при < 1 ГБ |
| Веб-застосунок | Vercel Hobby | безкоштовно | $0 |
| Сайт | Vercel Hobby (вже є) | безкоштовно | $0 |
| LLM: читання, нормалізація, сутності, пояснення, чат | Anthropic API; Gemini як резерв | за токени | $20–35 при 200 аркушах і тестах |
| Листи | Resend | безкоштовно до 3 000/міс | $0 |
| Домен | khronist.org | — | ≈ $15/рік |
| Трек B: GPU | Modal, A10G | за секунди, є стартові кредити | $15–20 лише якщо трек стартує |

Разом за листопад: $45–65 без треку B, $60–85 із ним (деталі в `09-checklist.md`). Railway обрано як найдешевший варіант, який не засинає від бездіяльності (безкоштовні тарифи Render і Fly засинають, що зіпсує демо). Запасний варіант для бази: Neon Free — той самий Postgres, міграція тривіальна.

## 2. Середовища й секрети

Два середовища: `local` і `prod` (Railway environment `production`). Preview від Railway на PR — за бажанням. Секрети зберігаються в Railway Variables і Vercel Env; у репозиторії — лише `.env.example`.

| Змінна | Де потрібна | Опис |
| --- | --- | --- |
| `DATABASE_URL` | api | postgres.js URL |
| `NODE_ENV`, `PORT`, `HOST`, `LOG_LEVEL` | api | середовище й сервер |
| `CLIENT_IP_HEADER` | api | на Railway `x-real-ip` |
| `GUEST_RECOGNITIONS_PER_DAY`, `MODEL_CALLS_PER_DAY` | api | 300 нових читань гостя на добу, 4000 викликів моделей на добу |
| `API_KEY_RECOGNITIONS_PER_DAY` | api | 1000 нових читань на ключ API на добу |
| `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` | api, Railway | вікно дренажу, на проді 150 |
| `LLM_FIXTURES`, `HTR_EFFORT`, `LLM_EFFORT` | api | фікстурне читання; глибина читання; глибина текстових задач |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | api | вхід (V-15): секрет від 32 символів; адреса API, у проді лише `https` |
| `RESEND_API_KEY`, `MAIL_FROM`, `SIGN_IN_CODES_PER_DAY` | api | листи з кодом входу; без ключа Resend входу немає; 300 листів на добу |
| `VERIFIER_EMAILS` | api | адреси через кому, хто може підтверджувати; порожньо — ніхто; у Railway задається вручну (`preserve()`) |
| `ANTHROPIC_API_KEY`, `LLM_MODEL_PRIMARY`, `HTR_MODEL_PRIMARY` | api | назви моделей звірити в документації Anthropic; читання може використовувати іншу модель, ніж текстові задачі |
| `GOOGLE_API_KEY`, `LLM_MODEL_FALLBACK`, `HTR_MODEL_FALLBACK` | api | резерв |
| `HTR_URL`, `HTR_API_KEY` | api | порожні за замовчуванням; задаються лише при перемиканні на трек B |
| `JOBS_CONCURRENCY`, `RETRIEVAL_MIN_RANK` | api | 4 і 0,05 стартово |
| `ADMIN_API_KEY` | api, services/knowledge | інгестія корпусу; у проді від 32 символів, без нього маршрутів адмінки немає |
| `CORS_ORIGINS` | api | веб-домен; розширенню не потрібен (`host_permissions`) |
| `KHRONIST_API_URL`, `KHRONIST_API_KEY` | services/knowledge, scripts | оцінка й пакетна обробка |
| `HF_TOKEN` | Modal secret (трек B) | завантаження ваг моделі |

## 3. Локальна розробка

`infra/docker-compose.yml`: `postgres:18` на 5432 з `pg_trgm`. Команди: `pnpm dev` (Turborepo запускає api, extension і web — `http://localhost:5173`), `pnpm db:migrate`. Без ключів LLM API працює у режимі фікстур (`LLM_FIXTURES=1`): читання повертає записаний фрагмент з `apps/api/src/services/htr/fixture.ts`, щоб фронтенд розроблявся без витрат. Розширення з `wxt dev` ходить на `http://localhost:3000`, зібране — на `https://api.khronist.org`.

## 4. CI/CD (GitHub Actions)

- `ci.yml` на кожен PR: `pnpm install --frozen-lockfile`, `turbo lint typecheck test build`; для `services/*` — `uv sync`, `ruff`, `pytest`. Контрактний тест: згенерований OpenAPI збігається зі схемами.
- Railway деплоїть `main` у prod автоматично після зеленого CI.
- Vercel деплоїть `apps/web` з `main`.
- Розширення: `pnpm --filter extension zip` → артефакт `khronist-extension-<версія>.zip` у GitHub Release; для демо встановлюється як unpacked, у Chrome Web Store — після фіналу.
- Трек B: Modal деплоїться вручну командою з `services/htr`; версія ваг записується в `MODEL.md`.

## 5. Спостережуваність

- Логи pino у JSON; Railway збирає. Кожен запит має `requestId`, кожна задача — `recognitionId`.
- Метрики, які дивимось щодня в тижні MVP: p95 часу читання фрагмента, частка `failed`, частка резервних викликів, витрати токенів (з `usage`), кількість підтверджених аркушів. Виводяться `GET /v1/admin/stats` з API-ключем; дашборд не потрібен.
- Алерти: Railway health-check на `/health`.

## 6. Безпека й право

- Нічого не качаємо масово: обробляємо лише фрагмент, який користувач відкрив або який подано пакетним скриптом із явного списку; зберігаємо текст і координати, не зображення (крім буфера задачі, який чиститься через 24 год).
- Умови використання порталу прочитати до 4 листопада й зафіксувати в `docs/portal-searcharchives.md`.
- Дані користувачів: email і підпис; політика приватності на сайті.
- Ліміти для гостей; API-ключі хешовані; CSP розширення за замовчуванням WXT; жодних зовнішніх скриптів.

## 7. День демо

За годину до пітчу: демо-аркуші вже в Commons (кеш за хешем, тож читання миттєве навіть без API); один «свіжий» фрагмент перевірено з ранку; локальна копія сторінки порталу на випадок падіння порталу; записане відео-демо на ноутбуці; мобільний інтернет як запасний канал; Claude Desktop із налаштованим MCP відкритий заздалегідь; prod заморожений з 20-го; якщо трек B увімкнений — `warmup.py` і `keep_warm=1`.

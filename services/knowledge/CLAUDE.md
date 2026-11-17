Читай `docs/plan/04-ml-htr.md`, `docs/plan/05-knowledge-rag.md` і розділ 5 `docs/plan/07-contracts.md`.
- Кожна стаття корпусу має джерело з https-адресою й ліцензією (`суспільне надбання` або `CC BY-SA 4.0`); без джерела не додавати. Текст — переказ джерела без доповнень, варіанти написання — у `variants`, `wikidata_id` — лише перевірений.
- Формат перевіряє `src/khronist_knowledge/corpus.py`; `uv run pytest` має бути зеленим.
- Інгестія ідемпотентна (`articleKey` і номер чанка, синхронізація повним набором) і пише лише через `/v1/admin/*`, не напряму в прод-БД.
- Інгестія — `uv run python scripts/ingest.py`; перед запуском локально налаштувати `KHRONIST_API_URL` і `ADMIN_API_KEY` у кореневому `.env`. Скрипт надсилає повний набір чанків, тож не змінювати його на часткове завантаження.
- Оцінка читання — `eval/run_htr_eval.py`, звіт у `eval/results/<дата>-htr.md`; `eval/run_qa.py` ще не створено. Цифри не округлювати в кращий бік; на еталоні, який прочитала модель, метрика — розбіжність, а не CER.
- Перед комітом: `uv run ruff check && uv run ruff format --check && uv run pytest` (це робить і git-хук `pre-commit`).

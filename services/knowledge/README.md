# services/knowledge

Довідковий корпус, словник варіантів написання й оцінка читання та пояснень. Зона ML-команди (`docs/plan/04-ml-htr.md`, `docs/plan/05-knowledge-rag.md`).

## Запуск

```sh
cd services/knowledge
uv sync
uv run ruff check && uv run ruff format --check && uv run pytest
```

## Оцінка читання

Читає той самий код, що й прод (`createVisionReader` в `apps/api`), а рахує метрики Python:

```sh
uv run python eval/prepare_fragments.py
pnpm --filter @khronist/api read-fragments --model claude-sonnet-5-5 \
  --fragments ../../services/knowledge/eval/.cache/fragments --out <readings.jsonl>
uv run python eval/run_htr_eval.py --reference eval/reference/lines.jsonl \
  --readings <readings.jsonl> ... --out eval/results/<дата>-htr.md
```

Шляхи для `read-fragments` — абсолютні або від `apps/api`. Протокол метрик — `docs/decisions.md`, 14 листопада; походження еталона — `eval/reference/README.md`.

## Корпус

Одна стаття — один файл `data/entries/*.md`: YAML-шапка між рядками `---`, далі текст. Формат — `docs/plan/07-contracts.md`, розділ 5; перевіряє його `src/khronist_knowledge/corpus.py`, а тест `test_corpus_entries_are_valid` проганяє всі статті теки.

```yaml
---
term: восприємники
variants: [восприемники, воспріемники]
type: term
period: XIX
source_title: Назва джерела
source_url: https://…
source_kind: dictionary
licence: CC BY-SA 4.0
---
Текст статті лише з того, що є в джерелі.
```

- `type`: `term`, `place`, `date`, `unit`, `abbr`.
- `source_kind`: `dictionary`, `encyclopedia`, `wikidata`, `publication`.
- `wikidata_id` необов'язковий, вигляду `Q123`.
- Терміни не повторюються в межах одного `type` (без урахування регістру).

Кожне твердження статті має бути в джерелі за `source_url`. Без джерела статтю не додаємо.

### Правила наповнення

- Джерела: спершу Энциклопедический словарь Брокгауза и Ефрона з Вікіджерел (`licence: суспільне надбання`), де статті немає або потрібна сучасна назва — українська Вікіпедія (`licence: CC BY-SA 4.0`).
- `term` — слово так, як воно стоїть у документі, у написанні джерела; дореформені й українські форми — у `variants`.
- `period` — століття, які описує саме джерело, без домислів.
- Текст статті — українською, переказ джерела без доповнень.

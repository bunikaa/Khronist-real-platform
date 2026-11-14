# services/knowledge

Довідковий корпус, словник варіантів написання й оцінка читання та пояснень. Зона ML-команди (`docs/plan/04-ml-htr.md`, `docs/plan/05-knowledge-rag.md`).

## Запуск

```sh
cd services/knowledge
uv sync
uv run ruff check && uv run ruff format --check && uv run pytest
```

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

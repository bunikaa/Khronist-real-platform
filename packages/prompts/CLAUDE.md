Читай `docs/plan/04-ml-htr.md`, `docs/plan/05-knowledge-rag.md` і розділи 4, 8–11 `docs/plan/07-contracts.md`.
- Промпт = тека з `system.md`, `user.md`, `schema.json`, `README.md` і `examples.jsonl` (у `htr_vision` прикладів поки немає); зміна промпту без оновлення прикладів не приймається.
- `schema.json` дорівнює Zod-схемі з `packages/contracts`; це перевіряє тест пакета.
- Промпти забороняють відповідати без наданих джерел; у прикладах обов'язково є випадки «не знаю». `htr_vision` зберігає орфографію оригіналу й позначає непевні слова.
- Текст гостя (запис, запитання, історія) потрапляє в шаблон лише JSON; системний промпт каже, що це матеріал, а не інструкції.
- Додатки для резервної моделі — `<промпт>/gemini.md`; API підключає їх через `loadProviderNotes`.
- Після змін `htr_vision` — оцінка `services/knowledge/eval/run_htr_eval.py` і звіт у `services/knowledge/eval/results/`; цифри не округлювати в кращий бік.

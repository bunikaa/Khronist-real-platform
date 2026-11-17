import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

from khronist_knowledge.corpus import load_corpus
from khronist_knowledge.qa import QaError, QaItem

Outcome = Literal[
    "correct",
    "missed",
    "unsourced",
    "unknown_source",
    "irrelevant",
    "false_answer",
    "correct_no_answer",
    "failed",
]

OUTCOME_LABELS: dict[Outcome, str] = {
    "correct": "відповідь із релевантними цитатами",
    "missed": "«не знаю», хоча відповідь у корпусі є",
    "unsourced": "відповідь без джерела",
    "unknown_source": "цитата з джерела, якого немає в корпусі",
    "irrelevant": "цитата з нерелевантної статті",
    "false_answer": "відповідь, хоча в корпусі її немає",
    "correct_no_answer": "правильне «не знаю»",
    "failed": "запит не вдався",
}

RIGHT: frozenset[Outcome] = frozenset({"correct", "correct_no_answer"})


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Citation(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    chunkId: str
    title: str
    quote: str


class ExplainReply(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)

    answer: str | None
    reason: str | None = None
    confidence: str | None = None
    citations: list[Citation]


class Asked(Row):
    min_rank: str = Field(min_length=1)
    id: str = Field(min_length=1)
    reply: ExplainReply | None = None
    error: str | None = None

    @model_validator(mode="after")
    def check_result(self) -> "Asked":
        if (self.reply is None) == (self.error is None):
            raise ValueError("a run line needs either a reply or an error")
        return self


Run = tuple[str, dict[str, Asked]]


def read_jsonl(path: Path) -> list[tuple[int, object]]:
    rows: list[tuple[int, object]] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            rows.append((number, json.loads(line)))
        except json.JSONDecodeError as error:
            raise QaError(f"{path}:{number}: {error.msg}") from error
    return rows


def load_run(path: Path) -> Run:
    asked: dict[str, Asked] = {}
    for number, value in read_jsonl(path):
        try:
            row = Asked.model_validate(value)
        except ValidationError as error:
            raise QaError(f"{path}:{number}: {error}") from error
        if row.id in asked:
            raise QaError(f"{path}:{number}: repeated id {row.id}")
        asked[row.id] = row
    ranks = sorted({row.min_rank for row in asked.values()})
    if len(ranks) != 1:
        raise QaError(f"{path}: a run needs exactly one min_rank, found {ranks}")
    return ranks[0], asked


def titles_to_articles(entries: Path) -> dict[str, frozenset[str]]:
    found: dict[str, set[str]] = {}
    for article in load_corpus(entries):
        found.setdefault(article.meta.source_title, set()).add(article.path.stem)
    return {title: frozenset(keys) for title, keys in found.items()}


def judge(case: QaItem, asked: Asked | None, titles: dict[str, frozenset[str]]) -> Outcome:
    if asked is None or asked.reply is None:
        return "failed"
    reply = asked.reply
    if reply.answer is None:
        return "correct_no_answer" if case.expected == "no_answer" else "missed"
    if not reply.citations:
        return "unsourced"
    if case.expected == "no_answer":
        return "false_answer"
    relevant = set(case.relevant)
    outcome: Outcome = "correct"
    for citation in reply.citations:
        keys = titles.get(citation.title)
        if keys is None:
            return "unknown_source"
        if not keys & relevant:
            outcome = "irrelevant"
    return outcome


def score_run(
    cases: list[QaItem], asked: dict[str, Asked], titles: dict[str, frozenset[str]]
) -> dict[str, Outcome]:
    unknown = sorted(set(asked) - {case.id for case in cases})
    if unknown:
        raise QaError(f"run has ids missing from the questions: {', '.join(unknown)}")
    return {
        case.id: judge(case, asked.get(case.id), titles) for case in cases if case.mode == "explain"
    }


def floor_percent(part: int, whole: int) -> str:
    if whole == 0:
        return "—"
    tenths = part * 1000 // whole
    return f"{tenths // 10},{tenths % 10} %"


def share(part: int, whole: int) -> str:
    return f"{part} з {whole} ({floor_percent(part, whole)})"


def count(outcomes: dict[str, Outcome], *wanted: Outcome) -> int:
    return sum(1 for outcome in outcomes.values() if outcome in wanted)


def describe(case: QaItem, outcome: Outcome, asked: Asked | None) -> str:
    parts = [f"- `{case.id}` ({case.kind}) «{case.text}» — {OUTCOME_LABELS[outcome]}"]
    if asked is not None and asked.error is not None:
        parts.append(f"помилка: `{' '.join(asked.error.split())}`")
    if asked is not None and asked.reply is not None:
        reply = asked.reply
        cited = list(dict.fromkeys(citation.title for citation in reply.citations))
        if cited:
            parts.append("цитати: " + "; ".join(f"«{title}»" for title in cited))
        if reply.reason:
            parts.append(f"`reason: {reply.reason}`")
        if reply.confidence:
            parts.append(f"`confidence: {reply.confidence}`")
    if case.relevant:
        parts.append("очікувано: " + ", ".join(f"`{key}`" for key in case.relevant))
    return "; ".join(parts) + "."


def shared_sources(titles: dict[str, frozenset[str]]) -> list[str]:
    return [
        f"«{title}» — " + ", ".join(f"`{key}`" for key in sorted(keys))
        for title, keys in sorted(titles.items())
        if len(keys) > 1
    ]


def render(
    qa_path: str, cases: list[QaItem], runs: list[Run], titles: dict[str, frozenset[str]]
) -> str:
    explain = [case for case in cases if case.mode == "explain"]
    with_answer = [case for case in explain if case.expected == "answer"]
    without = [case for case in explain if case.expected == "no_answer"]
    out = [
        "# Оцінка «Пояснити»",
        "",
        f"Запитання: `{qa_path}`, режим `explain` — {len(explain)}: з відповіддю в корпусі — "
        f"{len(with_answer)}, без відповіді — {len(without)}. Запитання чату "
        f"({len(cases) - len(explain)}) не оцінювались: `run_qa.py` викликає лише "
        "`POST /v1/explain`.",
        "Поріг `RETRIEVAL_MIN_RANK` — змінна API, тож для кожного значення API перезапускався; "
        "у таблиці — значення, з яким запускали прогін.",
        "Цитата належить статті, якщо назва її джерела збігається з `source_title` статті в "
        "`data/entries`. Відповідь правильна, лише коли всі її цитати — зі статей, перелічених у "
        "`relevant` запитання.",
    ]
    shared = shared_sources(titles)
    if shared:
        out.append(
            "Одне джерело мають кілька статей: "
            + "; ".join(shared)
            + ". Цитата такого джерела релевантна, якщо релевантна хоч одна з цих статей."
        )
    out += [
        "",
        "| Поріг | Відповідей без джерела | Правильних «не знаю» | Правильних відповідей "
        "| «Не знаю», хоча відповідь є | Нерелевантні або невідомі цитати "
        "| Відповідь, хоча її немає | Запит не вдався |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    scored = [(rank, asked, score_run(cases, asked, titles)) for rank, asked in runs]
    for rank, _, outcomes in scored:
        out.append(
            f"| {rank} | {count(outcomes, 'unsourced')} "
            f"| {share(count(outcomes, 'correct_no_answer'), len(without))} "
            f"| {share(count(outcomes, 'correct'), len(with_answer))} "
            f"| {count(outcomes, 'missed')} "
            f"| {count(outcomes, 'irrelevant', 'unknown_source')} "
            f"| {count(outcomes, 'false_answer')} "
            f"| {count(outcomes, 'failed')} |"
        )
    out += [
        "",
        "Цілі (`docs/plan/05-knowledge-rag.md`, розділ 7): 0 відповідей без джерела, не менше "
        f"80 % правильних «не знаю». Запитань без відповіді — {len(without)}, тож одне запитання "
        f"змінює частку на {floor_percent(1, len(without))}. Частки округлено вниз.",
    ]
    by_id = {case.id: case for case in cases}
    for rank, asked, outcomes in scored:
        wrong = [
            (by_id[case_id], outcome)
            for case_id, outcome in outcomes.items()
            if outcome not in RIGHT
        ]
        out += ["", f"## Поріг {rank}", ""]
        if not wrong:
            out.append("Помилкових випадків немає.")
        out += [describe(case, outcome, asked.get(case.id)) for case, outcome in wrong]
    return "\n".join(out) + "\n"

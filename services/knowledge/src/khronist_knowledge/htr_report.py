import json
import statistics
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import jiwer
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError
from pydantic.alias_generators import to_camel

from khronist_knowledge.htr_eval import (
    HISTORIC_LETTERS,
    ILLEGIBLE,
    MISSING,
    char_errors,
    clean,
    legible_pair,
    letter_confusions,
    modernize,
    score_flags,
    score_names,
)


class EvalError(ValueError):
    pass


class Row(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, frozen=True)


class Word(Row):
    text: str
    uncertain: bool


class ReadLine(Row):
    text: str
    words: list[Word]


class Usage(Row):
    input_tokens: int
    output_tokens: int


class Reading(Row):
    fragment: str
    model: str
    reader: str
    settings: dict[str, str]
    duration_ms: int
    usage: Usage | None = None
    warnings: list[str]
    lines: list[ReadLine]


class FailedReading(Row):
    fragment: str
    model: str
    duration_ms: int
    error: str


ReadingRow = Reading | FailedReading
rows_adapter: TypeAdapter[ReadingRow] = TypeAdapter(ReadingRow)


@dataclass(frozen=True)
class Reference:
    text: str
    names: set[str]


@dataclass
class ModelTotals:
    read: int = 0
    failed: int = 0
    chars: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    errors: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    words: int = 0
    word_errors: int = 0
    name_chars: int = 0
    name_errors: int = 0
    flagged: int = 0
    wrong: int = 0
    flagged_and_wrong: int = 0
    hypothesis_words: int = 0
    illegible: int = 0
    confusions: Counter[tuple[str, str]] = field(default_factory=Counter)
    durations: list[int] = field(default_factory=list)
    input_tokens: int = 0
    output_tokens: int = 0
    per_fragment: dict[str, float] = field(default_factory=dict)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line]


def load_reference(path: Path) -> dict[str, Reference]:
    lines: dict[str, list[dict]] = defaultdict(list)
    for row in read_jsonl(path):
        lines[row["fragment"]].append(row)
    return {
        fragment: Reference(
            text=clean(" ".join(row["text"] for row in sorted(rows, key=lambda r: r["idx"]))),
            names={name for row in rows for name in row.get("names", [])},
        )
        for fragment, rows in lines.items()
    }


def load_readings(paths: list[Path]) -> list[ReadingRow]:
    rows: list[ReadingRow] = []
    seen: dict[tuple[str, str], str] = {}
    for path in paths:
        for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
            if not raw:
                continue
            place = f"{path.as_posix()}:{number}"
            try:
                row = rows_adapter.validate_json(raw)
            except ValidationError as error:
                raise EvalError(f"{place}: not a reading: {error}") from error
            key = (row.model, row.fragment)
            if key in seen:
                raise EvalError(f"{place}: {row.model} read {row.fragment} again, see {seen[key]}")
            seen[key] = place
            rows.append(row)
    return rows


def hypothesis_of(reading: Reading) -> tuple[str, list[bool]]:
    text = clean(" ".join(line.text for line in reading.lines))
    flags = [
        word.uncertain
        for line in reading.lines
        for word in line.words
        for _ in clean(word.text).split()
    ]
    return text, flags


def variant_pairs(reference: str, hypothesis: str) -> dict[str, tuple[str, str]]:
    return {
        "strict": (reference, hypothesis),
        "norm": (modernize(reference), modernize(hypothesis)),
        "legible": legible_pair(reference, hypothesis),
    }


def score_reading(totals: ModelTotals, reference: Reference, reading: Reading) -> None:
    hypothesis, uncertain = hypothesis_of(reading)
    for variant, (ref, hyp) in variant_pairs(reference.text, hypothesis).items():
        totals.chars[variant] += len(ref)
        totals.errors[variant] += char_errors(ref, hyp)
    totals.per_fragment[reading.fragment] = char_errors(reference.text, hypothesis) / max(
        len(reference.text), 1
    )
    words = jiwer.process_words(reference.text, hypothesis or " ")
    totals.words += len(reference.text.split())
    totals.word_errors += words.substitutions + words.deletions + words.insertions
    names = score_names(reference.text, hypothesis, reference.names)
    totals.name_chars += names.characters
    totals.name_errors += names.errors
    try:
        flags = score_flags(reference.text, hypothesis, uncertain)
    except ValueError as error:
        raise EvalError(f"{reading.model}, {reading.fragment}: {error}") from error
    totals.flagged += flags.flagged
    totals.wrong += flags.wrong
    totals.flagged_and_wrong += flags.flagged_and_wrong
    totals.hypothesis_words += len(uncertain)
    totals.illegible += hypothesis.count(ILLEGIBLE)
    totals.confusions.update(letter_confusions(*legible_pair(reference.text, hypothesis)))
    totals.durations.append(reading.duration_ms)
    if reading.usage:
        totals.input_tokens += reading.usage.input_tokens
        totals.output_tokens += reading.usage.output_tokens
    totals.read += 1


def evaluate(references: dict[str, Reference], rows: list[ReadingRow]) -> dict[str, ModelTotals]:
    results: dict[str, ModelTotals] = {}
    covered: dict[str, set[str]] = defaultdict(set)
    for row in rows:
        if row.fragment not in references:
            raise EvalError(f"{row.model} read {row.fragment}, which is not in the reference")
        totals = results.setdefault(row.model, ModelTotals())
        covered[row.model].add(row.fragment)
        if isinstance(row, FailedReading):
            totals.failed += 1
        else:
            score_reading(totals, references[row.fragment], row)
    for model, totals in results.items():
        totals.failed += len(references.keys() - covered[model])
    return results


def decimal(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def percent(part: int, whole: int) -> str:
    return f"{decimal(100 * part / whole)} %" if whole else "—"


def letter(char: str) -> str:
    return {MISSING: "—", " ": "пробіл"}.get(char, char)


def confusion_order(pair: tuple[str, str]) -> tuple[int, str, bool, str]:
    ref, hyp = pair
    anchor = ref if ref and ref in HISTORIC_LETTERS else hyp
    return HISTORIC_LETTERS.index(anchor), ref, ref != hyp, hyp


def render(
    references: dict[str, Reference],
    results: dict[str, ModelTotals],
    sources: list[str],
    reference_reader: str | None,
) -> str:
    ref_chars = sum(len(r.text) for r in references.values())
    ref_names = sum(len(r.names) for r in references.values())
    ref_illegible = sum(r.text.count(ILLEGIBLE) for r in references.values())
    cer = "Розбіжність" if reference_reader else "CER"
    wer = "Розбіжність слів" if reference_reader else "WER"
    out = [
        "# Оцінка читання",
        "",
        f"Еталон: `eval/reference/lines.jsonl` (походження — `eval/reference/README.md`), "
        f"{len(references)} фрагментів, {ref_chars} символів, {ref_names} різних імен, "
        f"`{ILLEGIBLE}` в еталоні: {ref_illegible}.",
        "Читання: " + ", ".join(f"`{s}`" for s in sources) + ".",
        "",
    ]
    if reference_reader:
        out += [
            f"Еталон — читання `{reference_reader}`, людиною не перевірене. Тому цифри нижче — "
            f"розбіжність з читанням `{reference_reader}` (CER і WER щодо нього), "
            "а не точність щодо оригіналу.",
            "",
        ]
    out += [
        "Метрики порахано на тексті фрагмента цілком (рядки через пробіл), після NFC. "
        "strict — буква в букву; norm — після ѣ→е, і→и, ѳ→ф, ѵ→и і без кінцевого ъ; "
        f"без `{ILLEGIBLE}` — слова `{ILLEGIBLE}` еталона прибрано разом зі словами читання, "
        "вирівняними з ними. Фрагмент без читання рахується як невдалий.",
        "",
        f"| Модель | Фрагменти | {cer} strict | {cer} norm | {cer} без [нрзб] | {wer} "
        f"| {cer} імен | Непевні слова | Позначки ловлять помилок | Позначки влучні | [нрзб] "
        "| Час, с (сер. / макс.) | Токени (вх. / вих.) |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for model, t in results.items():
        mean = statistics.mean(t.durations) / 1000 if t.durations else 0
        peak = max(t.durations) / 1000 if t.durations else 0
        out.append(
            f"| `{model}` | {t.read} з {t.read + t.failed} "
            f"| {percent(t.errors['strict'], t.chars['strict'])} "
            f"| {percent(t.errors['norm'], t.chars['norm'])} "
            f"| {percent(t.errors['legible'], t.chars['legible'])} "
            f"| {percent(t.word_errors, t.words)} "
            f"| {percent(t.name_errors, t.name_chars)} "
            f"| {percent(t.flagged, t.hypothesis_words)} "
            f"| {percent(t.flagged_and_wrong, t.wrong)} "
            f"| {percent(t.flagged_and_wrong, t.flagged)} "
            f"| {t.illegible} | {decimal(mean)} / {decimal(peak)} "
            f"| {t.input_tokens} / {t.output_tokens} |"
        )
    out += ["", f"## {cer} strict за фрагментами", ""]
    out.append("| Фрагмент | " + " | ".join(f"`{m}`" for m in results) + " |")
    out.append("| --- |" + " --- |" * len(results))
    for fragment in references:
        cells = [
            f"{decimal(100 * t.per_fragment[fragment])} %" if fragment in t.per_fragment else "—"
            for t in results.values()
        ]
        out.append(f"| {fragment} | " + " | ".join(cells) + " |")
    pairs = sorted({pair for t in results.values() for pair in t.confusions}, key=confusion_order)
    out += [
        "",
        "## Плутанини історичних літер",
        "",
        "Посимвольне вирівнювання еталона й читання без урахування регістру: що стоїть у читанні "
        "на місці історичної літери еталона і що в еталоні на місці історичної літери читання. "
        "«—» — літери немає.",
        "",
        "| Еталон | Читання | " + " | ".join(f"`{m}`" for m in results) + " |",
        "| --- | --- |" + " --- |" * len(results),
    ]
    for ref, hyp in pairs:
        cells = [str(t.confusions[(ref, hyp)]) for t in results.values()]
        out.append(f"| {letter(ref)} | {letter(hyp)} | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"

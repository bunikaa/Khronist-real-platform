import argparse
import json
import statistics
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

import jiwer

from khronist_knowledge.htr_eval import (
    HISTORIC_LETTERS,
    ILLEGIBLE,
    char_errors,
    clean,
    historic_letters,
    modernize,
    score_flags,
    score_names,
    without_illegible,
)


@dataclass
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
    letters: dict[str, int] = field(default_factory=lambda: defaultdict(int))
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


VARIANTS = {"strict": clean, "norm": modernize, "legible": without_illegible}


def score_reading(totals: ModelTotals, reference: Reference, reading: dict) -> None:
    hypothesis = clean(" ".join(line["text"] for line in reading["lines"]))
    uncertain = [word["uncertain"] for line in reading["lines"] for word in line["words"]]
    for variant, transform in VARIANTS.items():
        ref, hyp = transform(reference.text), transform(hypothesis)
        totals.chars[variant] += len(ref)
        totals.errors[variant] += char_errors(ref, hyp)
    totals.per_fragment[reading["fragment"]] = char_errors(reference.text, hypothesis) / max(
        len(reference.text), 1
    )
    words = jiwer.process_words(reference.text, hypothesis or " ")
    totals.words += len(reference.text.split())
    totals.word_errors += words.substitutions + words.deletions + words.insertions
    names = score_names(reference.text, hypothesis, reference.names)
    totals.name_chars += names.characters
    totals.name_errors += names.errors
    flags = score_flags(reference.text, hypothesis, uncertain)
    totals.flagged += flags.flagged
    totals.wrong += flags.wrong
    totals.flagged_and_wrong += flags.flagged_and_wrong
    totals.hypothesis_words += len(uncertain)
    totals.illegible += hypothesis.count(ILLEGIBLE)
    for letter, count in historic_letters(hypothesis).items():
        totals.letters[letter] += count
    totals.durations.append(reading["durationMs"])
    usage = reading.get("usage") or {}
    totals.input_tokens += usage.get("inputTokens", 0)
    totals.output_tokens += usage.get("outputTokens", 0)
    totals.read += 1


def decimal(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def percent(part: int, whole: int) -> str:
    return f"{decimal(100 * part / whole)} %" if whole else "—"


def render(
    references: dict[str, Reference], results: dict[str, ModelTotals], sources: list[str]
) -> str:
    ref_chars = sum(len(r.text) for r in references.values())
    ref_names = sum(len(r.names) for r in references.values())
    ref_illegible = sum(r.text.count(ILLEGIBLE) for r in references.values())
    ref_letters = defaultdict(int)
    for reference in references.values():
        for letter, count in historic_letters(reference.text).items():
            ref_letters[letter] += count
    out = [
        "# Оцінка читання",
        "",
        f"Еталон: `eval/reference/lines.jsonl` (походження — `eval/reference/README.md`), "
        f"{len(references)} фрагментів, {ref_chars} символів, {ref_names} різних імен, "
        f"`{ILLEGIBLE}` в еталоні: {ref_illegible}.",
        "Читання: " + ", ".join(f"`{s}`" for s in sources) + ".",
        "",
        "Метрики порахано на тексті фрагмента цілком (рядки через пробіл), після NFC. "
        "strict — буква в букву; norm — після ѣ→е, і→и, ѳ→ф, ѵ→и і без кінцевого ъ; "
        f"без `{ILLEGIBLE}` — маркери прибрано з обох боків.",
        "",
        "| Модель | Фрагменти | CER strict | CER norm | CER без [нрзб] | WER | CER імен "
        "| Непевні слова | Позначки ловлять помилок | Позначки влучні | [нрзб] | Час, с "
        "(сер. / макс.) | Токени (вх. / вих.) |",
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
    out += ["", "## CER strict за фрагментами", ""]
    out.append("| Фрагмент | " + " | ".join(f"`{m}`" for m in results) + " |")
    out.append("| --- |" + " --- |" * len(results))
    for fragment in references:
        cells = [
            f"{decimal(100 * t.per_fragment[fragment])} %" if fragment in t.per_fragment else "—"
            for t in results.values()
        ]
        out.append(f"| {fragment} | " + " | ".join(cells) + " |")
    out += ["", "## Історичні літери (кількість)", ""]
    out.append("| Літера | Еталон | " + " | ".join(f"`{m}`" for m in results) + " |")
    out.append("| --- | --- |" + " --- |" * len(results))
    for letter in HISTORIC_LETTERS:
        cells = [str(t.letters[letter]) for t in results.values()]
        out.append(f"| {letter} | {ref_letters[letter]} | " + " | ".join(cells) + " |")
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--readings", type=Path, nargs="+", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    references = load_reference(args.reference)
    results: dict[str, ModelTotals] = {}
    for path in args.readings:
        for reading in read_jsonl(path):
            totals = results.setdefault(reading["model"], ModelTotals())
            if "error" in reading:
                totals.failed += 1
            elif reading["fragment"] in references:
                score_reading(totals, references[reading["fragment"]], reading)
    sources = [path.as_posix() for path in args.readings]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(render(references, results, sources), encoding="utf-8")
    print(args.out)


if __name__ == "__main__":
    main()

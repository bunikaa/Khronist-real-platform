import json
from pathlib import Path

import pytest

from khronist_knowledge.htr_report import (
    EvalError,
    Reading,
    Reference,
    evaluate,
    hypothesis_of,
    load_readings,
    render,
)

REFERENCES = {
    "a": Reference(text="Села [нрзб] Борщаговки", names=set()),
    "b": Reference(text="Ѳеодоръ", names={"Ѳеодоръ"}),
}


def reading(fragment: str, model: str = "m", words: list[tuple[str, bool]] | None = None) -> dict:
    words = words or [("Села", False), ("Ивана", True), ("Борщаговки", False)]
    return {
        "fragment": fragment,
        "model": model,
        "reader": model,
        "settings": {"effort": "medium"},
        "durationMs": 1000,
        "usage": {"inputTokens": 10, "outputTokens": 5},
        "warnings": [],
        "lines": [
            {
                "text": " ".join(text for text, _ in words),
                "words": [{"text": text, "uncertain": flag} for text, flag in words],
            }
        ],
    }


def write(tmp_path: Path, *rows: dict) -> Path:
    path = tmp_path / "readings.jsonl"
    path.write_text("".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), "utf-8")
    return path


def test_rejects_a_repeated_reading(tmp_path: Path) -> None:
    with pytest.raises(EvalError, match="read a again"):
        load_readings([write(tmp_path, reading("a"), reading("a"))])


def test_rejects_rows_that_are_not_readings(tmp_path: Path) -> None:
    with pytest.raises(EvalError, match="not a reading"):
        load_readings([write(tmp_path, {"fragment": "a", "model": "m"})])


def test_counts_missing_and_failed_fragments_as_failed(tmp_path: Path) -> None:
    rows = load_readings(
        [
            write(
                tmp_path,
                reading("a"),
                {"fragment": "b", "model": "x", "durationMs": 5, "error": "e"},
            )
        ]
    )
    results = evaluate(REFERENCES, rows)
    assert (results["m"].read, results["m"].failed) == (1, 1)
    assert (results["x"].read, results["x"].failed) == (0, 2)


def test_rejects_fragments_outside_the_reference(tmp_path: Path) -> None:
    with pytest.raises(EvalError, match="not in the reference"):
        evaluate(REFERENCES, load_readings([write(tmp_path, reading("c"))]))


def test_legible_variant_skips_words_read_in_place_of_illegible(tmp_path: Path) -> None:
    totals = evaluate(REFERENCES, load_readings([write(tmp_path, reading("a"))]))["m"]
    assert totals.errors["legible"] == 0
    assert totals.errors["strict"] > 0


def test_spreads_a_word_flag_over_its_parts() -> None:
    parsed = Reading.model_validate(reading("a", words=[("св. Николая", True), ("село", False)]))
    assert hypothesis_of(parsed) == ("св. Николая село", [True, True, False])


def test_report_names_the_reference_reader(tmp_path: Path) -> None:
    results = evaluate(REFERENCES, load_readings([write(tmp_path, reading("a"))]))
    report = render(REFERENCES, results, ["r.jsonl"], "claude-opus-5-5")
    assert "розбіжність з читанням `claude-opus-5-5`" in report
    assert "| Розбіжність strict | Розбіжність norm |" in report
    assert "## Плутанини історичних літер" in report

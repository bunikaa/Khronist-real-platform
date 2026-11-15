import json
from pathlib import Path

import pytest

from khronist_knowledge.corpus import load_corpus
from khronist_knowledge.qa import QaError, load_qa

ROOT = Path(__file__).parent.parent
QA = ROOT / "eval" / "qa.jsonl"
ENTRIES = ROOT / "data" / "entries"

VALID = {
    "id": "q01",
    "mode": "explain",
    "kind": "term",
    "text": "восприемники",
    "expected": "answer",
    "relevant": ["vospriemniki"],
}


def write(directory: Path, *rows: dict[str, object]) -> Path:
    path = directory / "qa.jsonl"
    lines = (json.dumps(row, ensure_ascii=False) for row in rows)
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def test_loads_a_valid_row(tmp_path: Path) -> None:
    [item] = load_qa(write(tmp_path, VALID))
    assert item.relevant == ["vospriemniki"]


@pytest.mark.parametrize(
    "change",
    [
        {"kind": None},
        {"mode": "chat"},
        {"relevant": []},
        {"expected": "no_answer"},
        {"relevant": ["vospriemniki", "vospriemniki"]},
        {"text": " "},
        {"text": "я" * 201},
        {"id": "1"},
        {"note": "зайве поле"},
    ],
)
def test_rejects_an_inconsistent_row(tmp_path: Path, change: dict[str, object]) -> None:
    with pytest.raises(QaError, match="qa.jsonl:1"):
        load_qa(write(tmp_path, VALID | change))


def test_rejects_repeated_ids(tmp_path: Path) -> None:
    with pytest.raises(QaError, match="q01 repeats"):
        load_qa(write(tmp_path, VALID, VALID))


def test_qa_set_has_twenty_answers_and_ten_refusals() -> None:
    items = load_qa(QA)
    assert len(items) == 30
    assert sum(item.expected == "answer" for item in items) == 20


def test_relevant_articles_exist() -> None:
    articles = {article.path.stem for article in load_corpus(ENTRIES)}
    missing = {key for item in load_qa(QA) for key in item.relevant} - articles
    assert not missing


def test_questions_without_answer_name_no_corpus_term() -> None:
    words = {
        word.strip().casefold()
        for article in load_corpus(ENTRIES)
        for word in [article.meta.term, *article.meta.variants]
    }
    named = [
        item.id
        for item in load_qa(QA)
        if item.expected == "no_answer" and item.text.strip().casefold() in words
    ]
    assert not named

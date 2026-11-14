from pathlib import Path

import pytest
from pydantic import ValidationError

from khronist_knowledge.corpus import CorpusError, load_corpus, parse_article

ENTRIES = Path(__file__).parent.parent / "data" / "entries"

META = """term: тест
variants: [тестъ]
type: term
period: XIX
source_title: Тестове джерело
source_url: https://example.org/test
source_kind: dictionary
licence: CC BY-SA 4.0"""


def write(directory: Path, name: str, content: str) -> Path:
    path = directory / name
    path.write_text(content, encoding="utf-8")
    return path


def test_parses_front_matter_and_body(tmp_path: Path) -> None:
    article = parse_article(write(tmp_path, "a.md", f"---\n{META}\n---\n\nТекст статті.\n"))
    assert article.meta.term == "тест"
    assert article.meta.variants == ["тестъ"]
    assert article.meta.source_kind == "dictionary"
    assert article.text == "Текст статті."


def test_rejects_file_without_front_matter(tmp_path: Path) -> None:
    with pytest.raises(CorpusError, match="front matter"):
        parse_article(write(tmp_path, "a.md", "Текст без шапки.\n"))


@pytest.mark.parametrize(
    "meta",
    [
        META.replace("source_kind: dictionary\n", ""),
        META + "\nauthor: хтось",
        META + "\nwikidata_id: 123",
        META.replace("https://example.org/test", "example.org/test"),
    ],
)
def test_rejects_invalid_meta(tmp_path: Path, meta: str) -> None:
    with pytest.raises(ValidationError):
        parse_article(write(tmp_path, "a.md", f"---\n{meta}\n---\nТекст.\n"))


def test_rejects_empty_body(tmp_path: Path) -> None:
    with pytest.raises(ValidationError):
        parse_article(write(tmp_path, "a.md", f"---\n{META}\n---\n\n"))


def test_rejects_duplicate_terms(tmp_path: Path) -> None:
    write(tmp_path, "a.md", f"---\n{META}\n---\nТекст.\n")
    write(tmp_path, "b.md", f"---\n{META.replace('тест', 'ТЕСТ', 1)}\n---\nТекст.\n")
    with pytest.raises(CorpusError, match="duplicates"):
        load_corpus(tmp_path)


def test_corpus_entries_are_valid() -> None:
    load_corpus(ENTRIES)

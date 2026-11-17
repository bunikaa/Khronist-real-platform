from pathlib import Path

import pytest

from khronist_knowledge.corpus import CorpusError
from khronist_knowledge.synonyms import load_synonyms


def write(tmp_path: Path, text: str) -> Path:
    path = tmp_path / "synonyms.yaml"
    path.write_text(text, encoding="utf-8")
    return path


def test_loads_names_and_places(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        "synonyms:\n"
        "  - term: Іван\n    type: person\n    variants: [Иван, Іоаннъ]\n"
        "  - term: Борщагівка\n    type: place\n    variants: [Борщаговка]\n",
    )

    dictionary = load_synonyms(path)

    assert [(entry.term, entry.type, entry.variants) for entry in dictionary.synonyms] == [
        ("Іван", "person", ["Иван", "Іоаннъ"]),
        ("Борщагівка", "place", ["Борщаговка"]),
    ]


def test_same_term_of_different_types_is_allowed(tmp_path: Path) -> None:
    path = write(
        tmp_path,
        "synonyms:\n"
        "  - term: Марія\n    type: person\n    variants: [Мария]\n"
        "  - term: Марія\n    type: place\n    variants: [Мариино]\n",
    )

    assert len(load_synonyms(path).synonyms) == 2


@pytest.mark.parametrize(
    ("case", "text"),
    [
        ("not a mapping", "- term: Іван\n"),
        ("unknown type", "synonyms:\n  - term: Іван\n    type: term\n    variants: [Иван]\n"),
        ("no variants", "synonyms:\n  - term: Іван\n    type: person\n    variants: []\n"),
        ("blank term", "synonyms:\n  - term: ' '\n    type: person\n    variants: [Иван]\n"),
        ("blank variant", "synonyms:\n  - term: Іван\n    type: person\n    variants: [' ']\n"),
        (
            "variant repeats the term",
            "synonyms:\n  - term: Іван\n    type: person\n    variants: [іван]\n",
        ),
        (
            "variant repeats another",
            "synonyms:\n  - term: Іван\n    type: person\n    variants: [Иван, иван]\n",
        ),
        (
            "term of one type twice",
            "synonyms:\n"
            "  - term: Іван\n    type: person\n    variants: [Иван]\n"
            "  - term: іван\n    type: person\n    variants: [Іоаннъ]\n",
        ),
        (
            "NUL character",
            'synonyms:\n  - term: "Іван\\0"\n    type: person\n    variants: [Иван]\n',
        ),
        (
            "NUL character in a variant",
            'synonyms:\n  - term: Іван\n    type: person\n    variants: ["Иван\\0"]\n',
        ),
        (
            "extra field",
            "synonyms:\n  - term: Іван\n    type: person\n    variants: [Иван]\n    x: 1\n",
        ),
        ("broken YAML", "synonyms: [\n"),
    ],
)
def test_rejects_invalid_dictionary(tmp_path: Path, case: str, text: str) -> None:
    with pytest.raises(CorpusError):
        load_synonyms(write(tmp_path, text))


def test_missing_file_is_reported(tmp_path: Path) -> None:
    with pytest.raises(CorpusError, match="does not exist"):
        load_synonyms(tmp_path / "synonyms.yaml")

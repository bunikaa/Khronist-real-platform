import json
from pathlib import Path

import pytest

from khronist_knowledge.qa import QaError, QaItem
from khronist_knowledge.qa_report import (
    Asked,
    Citation,
    ExplainReply,
    judge,
    load_run,
    render,
    score_run,
    titles_to_articles,
)

ENTRIES = Path(__file__).resolve().parents[1] / "data" / "entries"
TITLES = {
    "Статья «Дьячок»": frozenset({"dyachok"}),
    "Статья «Крестьяне»": frozenset({"krestyane", "krestyane-sobstvenniki"}),
}


def case(
    case_id: str = "q01", expected: str = "answer", relevant: list[str] | None = None
) -> QaItem:
    if relevant is None:
        relevant = ["dyachok"] if expected == "answer" else []
    return QaItem.model_validate(
        {
            "id": case_id,
            "mode": "explain",
            "kind": "term",
            "text": "дьячекъ",
            "expected": expected,
            "relevant": relevant,
        }
    )


def asked(answer: str | None, titles: list[str], case_id: str = "q01") -> Asked:
    citations = [
        Citation(chunkId=f"c{index}", title=title, quote="цитата з джерела")
        for index, title in enumerate(titles)
    ]
    reply = ExplainReply(answer=answer, citations=citations)
    return Asked(min_rank="0.05", id=case_id, reply=reply)


def write_jsonl(path: Path, rows: list[dict[str, object]]) -> Path:
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows), encoding="utf-8"
    )
    return path


def test_answer_with_relevant_citation_is_correct() -> None:
    assert judge(case(), asked("Дьячок — читець.", ["Статья «Дьячок»"]), TITLES) == "correct"


def test_shared_source_counts_when_one_article_is_relevant() -> None:
    question = case(relevant=["krestyane-sobstvenniki"])
    assert judge(question, asked("Відповідь.", ["Статья «Крестьяне»"]), TITLES) == "correct"


def test_one_unrelated_citation_makes_answer_irrelevant() -> None:
    reply = asked("Відповідь.", ["Статья «Дьячок»", "Статья «Крестьяне»"])
    assert judge(case(), reply, TITLES) == "irrelevant"


def test_citation_outside_corpus_is_unknown() -> None:
    assert judge(case(), asked("Відповідь.", ["Інше джерело"]), TITLES) == "unknown_source"


@pytest.mark.parametrize("expected", ["answer", "no_answer"])
def test_answer_without_citations_is_unsourced(expected: str) -> None:
    assert judge(case(expected=expected), asked("Відповідь.", []), TITLES) == "unsourced"


def test_no_answer_where_corpus_has_one_is_missed() -> None:
    assert judge(case(), asked(None, []), TITLES) == "missed"


def test_no_answer_where_corpus_is_empty_is_correct() -> None:
    assert judge(case(expected="no_answer"), asked(None, []), TITLES) == "correct_no_answer"


def test_answer_where_corpus_is_empty_is_false() -> None:
    reply = asked("Відповідь.", ["Статья «Дьячок»"])
    assert judge(case(expected="no_answer"), reply, TITLES) == "false_answer"


def test_error_and_missing_reply_are_failed() -> None:
    error = Asked(min_rank="0.05", id="q01", error="HTTP 503: reader_unavailable")
    assert judge(case(), error, TITLES) == "failed"
    assert judge(case(), None, TITLES) == "failed"


def test_load_run_rejects_mixed_thresholds(tmp_path: Path) -> None:
    first = asked(None, [], "q01").model_dump()
    second = asked(None, [], "q02").model_dump() | {"min_rank": "0.1"}
    with pytest.raises(QaError, match="exactly one min_rank"):
        load_run(write_jsonl(tmp_path / "run.jsonl", [first, second]))


def test_score_run_skips_chat_and_rejects_unknown_ids() -> None:
    chat = QaItem.model_validate(
        {"id": "q02", "mode": "chat", "text": "Питання?", "expected": "answer", "relevant": ["x"]}
    )
    assert score_run([case(), chat], {"q01": asked(None, [])}, TITLES) == {"q01": "missed"}
    with pytest.raises(QaError, match="q09"):
        score_run([case()], {"q09": asked(None, [], "q09")}, TITLES)


def test_titles_come_from_corpus_sources() -> None:
    titles = titles_to_articles(ENTRIES)
    assert titles["Энциклопедический словарь Брокгауза и Ефрона, статья «Дьячок»"] == {"dyachok"}


def test_render_floors_shares_and_lists_wrong_cases() -> None:
    cases = [case(f"q0{index}", expected="no_answer") for index in range(1, 4)]
    run = {
        "q01": asked(None, [], "q01"),
        "q02": asked(None, [], "q02"),
        "q03": asked("Відповідь.", ["Статья «Дьячок»"], "q03"),
    }
    text = render("eval/qa.jsonl", cases, [("0.05", run)], TITLES)
    assert "| 0.05 | 0 | 2 з 3 (66,6 %) | 0 з 0 (—) | 0 | 0 | 1 | 0 |" in text
    assert "`q03` (term) «дьячекъ» — відповідь, хоча в корпусі її немає" in text

from khronist_knowledge.htr_eval import (
    char_errors,
    clean,
    historic_letters,
    modernize,
    score_flags,
    score_names,
    without_illegible,
)


def test_clean_composes_and_collapses_spaces() -> None:
    assert clean(" йван \n  село ") == "йван село"


def test_modernize_replaces_historic_letters_and_final_hard_sign() -> None:
    assert modernize("Крестьянинъ Ѳеодоръ, вѣра і объ") == "Крестьянин Феодор, вера и об"


def test_modernize_keeps_hard_sign_inside_a_word() -> None:
    assert modernize("объявленіе") == "объявление"


def test_without_illegible_drops_markers() -> None:
    assert without_illegible("Села [нрзб] Борщаговки") == "Села Борщаговки"


def test_char_errors_counts_edits() -> None:
    assert char_errors("Іоаннъ", "Иоаннъ") == 1
    assert char_errors("", "аб") == 2
    assert char_errors("аб", "") == 2


def test_score_names_counts_only_names() -> None:
    score = score_names(
        "Житель Іоаннъ Борзовскій", "Житель Иоаннъ Борковскій", {"Іоаннъ", "Борзовскій"}
    )
    assert score.characters == len("Іоаннъ") + len("Борзовскій")
    assert score.errors == 2


def test_score_names_counts_a_missing_name_in_full() -> None:
    score = score_names("Житель Іоаннъ", "Житель", {"Іоаннъ"})
    assert (score.characters, score.errors) == (6, 6)


def test_score_flags_matches_flags_with_errors() -> None:
    score = score_flags("Села Борщаговки Іоаннъ", "Села Борщаговки Иванъ", [False, True, True])
    assert (score.flagged, score.wrong, score.flagged_and_wrong) == (2, 1, 1)


def test_historic_letters_counts_both_cases() -> None:
    assert historic_letters("Ѳеодоръ ѳ ѣ") == {"ѣ": 1, "і": 0, "ъ": 1, "ѳ": 2, "ѵ": 0}

from collections import Counter

import pytest

from khronist_knowledge.htr_eval import (
    char_errors,
    clean,
    legible_pair,
    letter_confusions,
    modernize,
    score_flags,
    score_names,
)


def test_clean_composes_and_collapses_spaces() -> None:
    assert clean(" йван \n  село ") == "йван село"


def test_modernize_replaces_historic_letters_and_final_hard_sign() -> None:
    assert modernize("Крестьянинъ Ѳеодоръ, вѣра і объ") == "Крестьянин Феодор, вера и об"


def test_modernize_keeps_hard_sign_inside_a_word() -> None:
    assert modernize("объявленіе") == "объявление"


def test_legible_pair_drops_illegible_words_with_their_reading() -> None:
    assert legible_pair("Села [нрзб] Борщаговки", "Села Ивана Борщаговки") == (
        "Села Борщаговки",
        "Села Борщаговки",
    )


def test_legible_pair_drops_every_word_read_in_place_of_one_illegible() -> None:
    assert legible_pair("Села [нрзб] Борщаговки", "Села Ивана Петра Борщаговки") == (
        "Села Борщаговки",
        "Села Борщаговки",
    )


def test_letter_confusions_ignore_surrounding_spaces() -> None:
    assert letter_confusions(" ъ", "ъ") == Counter({("ъ", "ъ"): 1})


def test_legible_pair_keeps_words_the_reference_could_read() -> None:
    assert legible_pair("Села Борщаговки", "Села Борщаговки жители") == (
        "Села Борщаговки",
        "Села Борщаговки жители",
    )


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


def test_score_flags_rejects_flags_that_do_not_match_the_words() -> None:
    with pytest.raises(ValueError, match="one uncertainty flag per word"):
        score_flags("Села Борщаговки", "Села Борщаговки", [False])


def test_letter_confusions_pairs_historic_letters_by_alignment() -> None:
    confusions = letter_confusions("Ѳеодоръ вѣра", "Өеодор вѣра")
    assert confusions == {("ѳ", "ө"): 1, ("ъ", ""): 1, ("ѣ", "ѣ"): 1}


def test_letter_confusions_counts_historic_letters_the_reading_added() -> None:
    assert letter_confusions("Иван", "Іван") == {("и", "і"): 1}
    assert letter_confusions("", "ъ") == {("", "ъ"): 1}

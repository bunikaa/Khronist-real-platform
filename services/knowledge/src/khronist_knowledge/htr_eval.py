import re
import unicodedata
from dataclasses import dataclass

import jiwer

ILLEGIBLE = "[нрзб]"
HISTORIC_LETTERS = "ѣіъѳѵ"
MODERN_EQUIVALENTS = str.maketrans("ѣѢіІѳѲѵѴ", "еЕиИфФиИ")
FINAL_HARD_SIGN = re.compile(r"[ъЪ](?=$|[\s.,;:!?)\-—])")


def clean(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def modernize(text: str) -> str:
    return clean(FINAL_HARD_SIGN.sub("", clean(text).translate(MODERN_EQUIVALENTS)))


def without_illegible(text: str) -> str:
    return clean(text.replace(ILLEGIBLE, " "))


def char_errors(reference: str, hypothesis: str) -> int:
    output = jiwer.process_characters(reference, hypothesis)
    return output.substitutions + output.deletions + output.insertions


@dataclass(frozen=True)
class AlignedWord:
    reference: str | None
    hypothesis: str | None
    hypothesis_index: int | None


def align_words(reference: str, hypothesis: str) -> list[AlignedWord]:
    ref_words, hyp_words = reference.split(), hypothesis.split()
    if not ref_words or not hyp_words:
        return [AlignedWord(w, None, None) for w in ref_words] + [
            AlignedWord(None, w, i) for i, w in enumerate(hyp_words)
        ]
    output = jiwer.process_words(reference, hypothesis)
    aligned: list[AlignedWord] = []
    for chunk in output.alignments[0]:
        refs = ref_words[chunk.ref_start_idx : chunk.ref_end_idx]
        hyps = list(range(chunk.hyp_start_idx, chunk.hyp_end_idx))
        if chunk.type in ("equal", "substitute"):
            aligned += [AlignedWord(r, hyp_words[h], h) for r, h in zip(refs, hyps, strict=True)]
        elif chunk.type == "delete":
            aligned += [AlignedWord(r, None, None) for r in refs]
        else:
            aligned += [AlignedWord(None, hyp_words[h], h) for h in hyps]
    return aligned


@dataclass(frozen=True)
class NameScore:
    characters: int
    errors: int


def score_names(reference: str, hypothesis: str, names: set[str]) -> NameScore:
    characters = errors = 0
    for word in align_words(reference, hypothesis):
        if word.reference is None or word.reference not in names:
            continue
        characters += len(word.reference)
        errors += char_errors(word.reference, word.hypothesis or "")
    return NameScore(characters, errors)


@dataclass(frozen=True)
class FlagScore:
    flagged: int
    wrong: int
    flagged_and_wrong: int


def score_flags(reference: str, hypothesis: str, uncertain: list[bool]) -> FlagScore:
    flagged = wrong = both = 0
    for word in align_words(reference, hypothesis):
        if word.hypothesis_index is None:
            continue
        is_flagged = uncertain[word.hypothesis_index]
        is_wrong = word.reference != word.hypothesis
        flagged += is_flagged
        wrong += is_wrong
        both += is_flagged and is_wrong
    return FlagScore(flagged, wrong, both)


def historic_letters(text: str) -> dict[str, int]:
    lower = text.lower()
    return {letter: lower.count(letter) for letter in HISTORIC_LETTERS}

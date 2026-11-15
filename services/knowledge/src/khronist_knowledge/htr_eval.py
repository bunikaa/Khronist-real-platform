import re
import unicodedata
from collections import Counter
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


def legible_pair(reference: str, hypothesis: str) -> tuple[str, str]:
    aligned = align_words(reference, hypothesis)
    dropped = {index for index, word in enumerate(aligned) if word.reference == ILLEGIBLE}
    for index in sorted(dropped):
        for step in (-1, 1):
            near = index + step
            while 0 <= near < len(aligned) and aligned[near].reference is None:
                dropped.add(near)
                near += step
    kept = [word for index, word in enumerate(aligned) if index not in dropped]
    return (
        " ".join(word.reference for word in kept if word.reference is not None),
        " ".join(word.hypothesis for word in kept if word.hypothesis is not None),
    )


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
    if len(uncertain) != len(hypothesis.split()):
        raise ValueError("there must be one uncertainty flag per word of the hypothesis")
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


MISSING = ""


def letter_confusions(reference: str, hypothesis: str) -> Counter[tuple[str, str]]:
    ref = clean(reference).lower()
    hyp = clean(hypothesis).lower()
    pairs: list[tuple[str, str]] = []
    if not ref or not hyp:
        pairs = [(c, MISSING) for c in ref] + [(MISSING, c) for c in hyp]
    else:
        for chunk in jiwer.process_characters(ref, hyp).alignments[0]:
            refs = ref[chunk.ref_start_idx : chunk.ref_end_idx]
            hyps = hyp[chunk.hyp_start_idx : chunk.hyp_end_idx]
            if chunk.type in ("equal", "substitute"):
                pairs += list(zip(refs, hyps, strict=True))
            elif chunk.type == "delete":
                pairs += [(c, MISSING) for c in refs]
            else:
                pairs += [(MISSING, c) for c in hyps]
    historic = set(HISTORIC_LETTERS)
    return Counter((r, h) for r, h in pairs if r in historic or h in historic)

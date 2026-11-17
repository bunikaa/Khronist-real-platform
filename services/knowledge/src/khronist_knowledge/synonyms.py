from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from khronist_knowledge.corpus import CorpusError, check_storable_text

SynonymType = Literal["person", "place"]


class SynonymEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    term: str = Field(min_length=1)
    type: SynonymType
    variants: list[str] = Field(min_length=1)

    @field_validator("term")
    @classmethod
    def check_term(cls, term: str) -> str:
        check_storable_text(term)
        if not term.strip():
            raise ValueError("term must not be empty")
        return term

    @field_validator("variants")
    @classmethod
    def check_variant_text(cls, variants: list[str]) -> list[str]:
        return [check_storable_text(variant) for variant in variants]

    @model_validator(mode="after")
    def check_variants(self) -> "SynonymEntry":
        seen = {self.term.strip().casefold()}
        for variant in self.variants:
            key = variant.strip().casefold()
            if not key:
                raise ValueError("variants must not be empty")
            if key in seen:
                raise ValueError(f"variant {variant!r} repeats the term or another variant")
            seen.add(key)
        return self


class SynonymDictionary(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    synonyms: list[SynonymEntry]

    @model_validator(mode="after")
    def check_unique_terms(self) -> "SynonymDictionary":
        seen: set[tuple[str, str]] = set()
        for entry in self.synonyms:
            key = (entry.type, entry.term.strip().casefold())
            if key in seen:
                raise ValueError(f"term {entry.term!r} of type {entry.type} appears twice")
            seen.add(key)
        return self


def load_synonyms(path: Path) -> SynonymDictionary:
    if not path.is_file():
        raise CorpusError(f"{path}: synonyms file does not exist")
    try:
        return SynonymDictionary.model_validate(yaml.safe_load(path.read_text(encoding="utf-8")))
    except (yaml.YAMLError, ValidationError) as error:
        raise CorpusError(f"{path}: {error}") from error

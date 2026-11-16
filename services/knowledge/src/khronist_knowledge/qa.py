import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

QaMode = Literal["explain", "chat"]
ExplainKind = Literal["term", "place", "date"]
Expected = Literal["answer", "no_answer"]

TEXT_LIMITS: dict[QaMode, int] = {"explain": 200, "chat": 2000}


class QaItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=r"^q[0-9]{2}$")
    mode: QaMode
    kind: ExplainKind | None = None
    text: str = Field(min_length=1)
    expected: Expected
    relevant: list[str]

    @model_validator(mode="after")
    def check_fields_agree(self) -> "QaItem":
        if self.mode == "explain" and self.kind is None:
            raise ValueError("an explain question needs a kind")
        if self.mode == "chat" and self.kind is not None:
            raise ValueError("a chat question has no kind")
        if not self.text.strip():
            raise ValueError("text must not be blank")
        limit = TEXT_LIMITS[self.mode]
        if len(self.text) > limit:
            raise ValueError(f"text is longer than {limit} characters")
        if self.expected == "answer" and not self.relevant:
            raise ValueError("a question with an answer needs relevant articles")
        if self.expected == "no_answer" and self.relevant:
            raise ValueError("a question without an answer has no relevant articles")
        if len(set(self.relevant)) != len(self.relevant):
            raise ValueError("relevant articles repeat")
        return self


class QaError(ValueError):
    pass


def load_qa(path: Path) -> list[QaItem]:
    items: list[QaItem] = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        try:
            items.append(QaItem.model_validate(json.loads(line)))
        except ValueError as error:
            raise QaError(f"{path}:{number}: {error}") from error
    seen: set[str] = set()
    for item in items:
        if item.id in seen:
            raise QaError(f"{path}: id {item.id} repeats")
        seen.add(item.id)
    return items

from pathlib import Path
from typing import Literal

import yaml
from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field

ArticleType = Literal["term", "place", "date", "unit", "abbr"]
SourceKind = Literal["dictionary", "encyclopedia", "wikidata", "publication"]

NonEmpty = Field(min_length=1)


class ArticleMeta(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    term: str = NonEmpty
    variants: list[str]
    type: ArticleType
    period: str = NonEmpty
    source_title: str = NonEmpty
    source_url: AnyHttpUrl
    source_kind: SourceKind
    licence: str = NonEmpty
    wikidata_id: str | None = Field(default=None, pattern=r"^Q[1-9][0-9]*$")


class Article(BaseModel):
    model_config = ConfigDict(frozen=True)

    path: Path
    meta: ArticleMeta
    text: str = NonEmpty


class CorpusError(ValueError):
    pass


FRONT_MATTER = "---"


def parse_article(path: Path) -> Article:
    lines = path.read_text(encoding="utf-8").splitlines()
    if not lines or lines[0] != FRONT_MATTER or FRONT_MATTER not in lines[1:]:
        raise CorpusError(f"{path}: YAML front matter between --- lines is missing")
    end = lines.index(FRONT_MATTER, 1)
    meta = yaml.safe_load("\n".join(lines[1:end]))
    if not isinstance(meta, dict):
        raise CorpusError(f"{path}: front matter must be a mapping")
    text = "\n".join(lines[end + 1 :]).strip()
    return Article(path=path, meta=ArticleMeta.model_validate(meta), text=text)


def load_corpus(directory: Path) -> list[Article]:
    articles = [parse_article(path) for path in sorted(directory.glob("*.md"))]
    seen: dict[tuple[str, str], Path] = {}
    for article in articles:
        key = (article.meta.type, article.meta.term.casefold())
        if key in seen:
            raise CorpusError(f"{article.path}: duplicates {seen[key]}")
        seen[key] = article.path
    return articles

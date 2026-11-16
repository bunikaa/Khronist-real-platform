import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Literal
from uuid import UUID

from pydantic import AnyHttpUrl, BaseModel, ConfigDict, Field, ValidationError, model_validator

from khronist_knowledge.corpus import Article, ArticleType, Licence, SourceKind, load_corpus
from khronist_knowledge.synonyms import SynonymDictionary, load_synonyms

ROOT = Path(__file__).resolve().parents[3]
KNOWLEDGE_ROOT = Path(__file__).resolve().parents[1]
MAX_CHUNKS_BODY_BYTES = 2 * 1024 * 1024
CHUNK_OVERLAP = 160
ARTICLE_KEY = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SynonymPayloadType = Literal["term", "place", "date", "unit", "abbr", "person"]


class IngestError(ValueError):
    pass


def model_json_bytes(model: BaseModel) -> bytes:
    return model.model_dump_json(exclude_none=True).encode("utf-8")


class BoundaryModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class SourceItem(BoundaryModel):
    url: AnyHttpUrl
    title: str = Field(min_length=1)
    licence: Licence
    kind: SourceKind
    periodFrom: int = Field(ge=1, le=21)
    periodTo: int = Field(ge=1, le=21)

    @model_validator(mode="after")
    def check_period_order(self) -> "SourceItem":
        if self.periodFrom > self.periodTo:
            raise ValueError("periodFrom must not exceed periodTo")
        return self


class SourcesRequest(BoundaryModel):
    items: list[SourceItem] = Field(min_length=1)


class SourceResponseItem(BoundaryModel):
    id: UUID
    url: str


class SourcesResponse(BoundaryModel):
    items: list[SourceResponseItem]


class ChunkItem(BoundaryModel):
    articleKey: str = Field(pattern=r"^[a-z0-9]+(-[a-z0-9]+)*$")
    idx: int = Field(ge=0)
    sourceId: UUID
    text: str = Field(min_length=1)
    topic: str = Field(min_length=1)
    type: ArticleType
    periodFrom: int = Field(ge=1, le=21)
    periodTo: int = Field(ge=1, le=21)
    wikidataId: str | None = Field(default=None, pattern=r"^Q[1-9][0-9]*$")

    @model_validator(mode="after")
    def check_period_order(self) -> "ChunkItem":
        if self.periodFrom > self.periodTo:
            raise ValueError("periodFrom must not exceed periodTo")
        return self


class ChunksRequest(BoundaryModel):
    items: list[ChunkItem] = Field(min_length=1)

    @model_validator(mode="after")
    def check_unique_article_chunks(self) -> "ChunksRequest":
        keys = [(item.articleKey, item.idx) for item in self.items]
        if len(set(keys)) != len(keys):
            raise ValueError("each articleKey and idx pair must be unique")
        return self


class ChunksResponse(BoundaryModel):
    inserted: int = Field(ge=0)
    updated: int = Field(ge=0)
    unchanged: int = Field(ge=0)
    deleted: int = Field(ge=0)


class SynonymItem(BoundaryModel):
    term: str = Field(min_length=1)
    variant: str = Field(min_length=1)
    type: SynonymPayloadType


class SynonymsRequest(BoundaryModel):
    items: list[SynonymItem] = Field(min_length=1)


class SynonymsResponse(BoundaryModel):
    inserted: int = Field(ge=0)
    updated: int = Field(ge=0)
    unchanged: int = Field(ge=0)


class AdminApiClient:
    def __init__(
        self,
        base_url: str,
        api_key: str,
        opener: Callable[..., object] = urllib.request.urlopen,
    ) -> None:
        parsed = urllib.parse.urlsplit(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            raise IngestError("KHRONIST_API_URL must be an absolute HTTP(S) URL")
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise IngestError(
                "KHRONIST_API_URL must not contain credentials, a query, or a fragment"
            )
        if any(ord(char) <= 0x1F or 0x7F <= ord(char) <= 0x9F for char in base_url):
            raise IngestError("KHRONIST_API_URL must not contain control characters")
        if not api_key.strip():
            raise IngestError("ADMIN_API_KEY is required")
        if any(ord(char) <= 0x1F or 0x7F <= ord(char) <= 0x9F for char in api_key):
            raise IngestError("ADMIN_API_KEY must not contain control characters")
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.opener = opener

    def post(self, endpoint: str, payload: BaseModel) -> dict[str, object]:
        body = model_json_bytes(payload)
        request = urllib.request.Request(
            f"{self.base_url}/v1/admin/{endpoint}",
            data=body,
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with self.opener(request, timeout=30) as response:
                value = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            raise IngestError(f"POST /v1/admin/{endpoint} returned HTTP {error.code}") from error
        except urllib.error.URLError as error:
            raise IngestError(f"POST /v1/admin/{endpoint} failed: {error.reason}") from error
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise IngestError(f"POST /v1/admin/{endpoint} returned invalid JSON") from error
        if not isinstance(value, dict):
            raise IngestError(f"POST /v1/admin/{endpoint} response must be a JSON object")
        return value


def load_dotenv(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        key, separator, value = line.partition("=")
        if not separator or not key.strip() or os.environ.get(key.strip()):
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        else:
            value = value.split(" #", maxsplit=1)[0].rstrip()
        os.environ[key.strip()] = value


def choose_boundary(text: str, start: int, target: int) -> int:
    low = max(start + 1, target - 120)
    high = min(len(text), target + 120)
    candidates = [position for position in range(low, high) if text[position].isspace()]
    if candidates:
        return min(candidates, key=lambda position: abs(position - target))
    position = min(max(target, start + 1), len(text))
    return position


def split_article_text(text: str) -> list[str]:
    normalized = text.strip()
    if len(normalized) <= 1500:
        return [normalized]
    count = 2 if len(normalized) <= 3000 else 3
    target_length = math.ceil((len(normalized) + CHUNK_OVERLAP * (count - 1)) / count)
    chunks: list[str] = []
    start = 0
    for index in range(count):
        if index == count - 1:
            end = len(normalized)
        else:
            end = choose_boundary(normalized, start, start + target_length)
        chunk = normalized[start:end].strip()
        if not chunk:
            raise IngestError("article chunking produced an empty chunk")
        chunks.append(chunk)
        start = max(start + 1, end - CHUNK_OVERLAP)
    return chunks


def build_sources_request(articles: list[Article]) -> SourcesRequest:
    sources: dict[str, SourceItem] = {}
    for article in articles:
        meta = article.meta
        url = str(meta.source_url)
        try:
            sources[url] = SourceItem(
                url=url,
                title=meta.source_title,
                licence=meta.licence,
                kind=meta.source_kind,
                periodFrom=meta.period_from,
                periodTo=meta.period_to,
            )
        except ValidationError as error:
            raise IngestError(f"{article.path}: invalid source payload: {error}") from error
    return SourcesRequest(items=list(sources.values()))


def build_chunks_request(
    articles: list[Article], source_ids: dict[str, UUID] | None = None
) -> ChunksRequest:
    chunks: list[ChunkItem] = []
    for article in articles:
        meta = article.meta
        article_key = article.path.stem
        if not ARTICLE_KEY.fullmatch(article_key):
            raise IngestError(
                f"{article.path}: articleKey must use lowercase Latin letters, digits, and hyphens"
            )
        if source_ids is None:
            source_id = UUID("00000000-0000-0000-0000-000000000000")
        else:
            try:
                source_id = source_ids[str(meta.source_url)]
            except KeyError as error:
                raise IngestError(
                    f"{article.path}: source ID was not returned by the API"
                ) from error
        for index, text in enumerate(split_article_text(article.text)):
            try:
                chunks.append(
                    ChunkItem(
                        articleKey=article_key,
                        idx=index,
                        sourceId=source_id,
                        text=text,
                        topic=meta.term,
                        type=meta.type,
                        periodFrom=meta.period_from,
                        periodTo=meta.period_to,
                        wikidataId=meta.wikidata_id,
                    )
                )
            except ValidationError as error:
                raise IngestError(f"{article.path}: invalid chunk payload: {error}") from error
    request = ChunksRequest(items=chunks)
    body_size = len(model_json_bytes(request))
    if body_size > MAX_CHUNKS_BODY_BYTES:
        raise IngestError(
            f"full chunks request is {body_size} bytes; API limit is {MAX_CHUNKS_BODY_BYTES} bytes"
        )
    return request


def build_synonyms_request(
    articles: list[Article], dictionary: SynonymDictionary
) -> SynonymsRequest:
    items: dict[tuple[str, str], SynonymItem] = {}

    def add_item(item: SynonymItem) -> None:
        key = (item.term, item.variant)
        existing = items.get(key)
        if existing is not None and existing.type != item.type:
            raise IngestError(
                f"synonym pair {item.term!r} / {item.variant!r} has conflicting types"
            )
        items[key] = item

    for article in articles:
        for variant in article.meta.variants:
            item = SynonymItem(term=article.meta.term, variant=variant, type=article.meta.type)
            add_item(item)
    for entry in dictionary.synonyms:
        for variant in entry.variants:
            item = SynonymItem(term=entry.term, variant=variant, type=entry.type)
            add_item(item)
    return SynonymsRequest(items=list(items.values()))


def source_id_map(response: SourcesResponse, request: SourcesRequest) -> dict[str, UUID]:
    result: dict[str, UUID] = {}
    for item in response.items:
        if item.url in result:
            raise IngestError(f"sources response contains duplicate URL {item.url!r}")
        result[item.url] = item.id
    expected = {str(item.url) for item in request.items}
    missing = expected - result.keys()
    if missing:
        raise IngestError(f"sources response omitted URL(s): {', '.join(sorted(missing))}")
    return result


def ingest(
    client: AdminApiClient,
    entries_directory: Path,
    synonyms_path: Path,
) -> tuple[SourcesResponse, ChunksResponse, SynonymsResponse]:
    articles = load_corpus(entries_directory)
    dictionary = load_synonyms(synonyms_path)
    sources_request = build_sources_request(articles)
    preflight_chunks = build_chunks_request(articles)
    synonyms_request = build_synonyms_request(articles, dictionary)

    sources_response = SourcesResponse.model_validate(client.post("sources", sources_request))
    ids_by_url = source_id_map(sources_response, sources_request)
    chunks_request = build_chunks_request(articles, ids_by_url)
    if len(model_json_bytes(chunks_request)) != len(model_json_bytes(preflight_chunks)):
        raise IngestError("resolved source IDs changed the preflight chunks request size")
    chunks_response = ChunksResponse.model_validate(client.post("chunks", chunks_request))
    synonyms_response = SynonymsResponse.model_validate(client.post("synonyms", synonyms_request))
    return sources_response, chunks_response, synonyms_response


def main() -> int:
    load_dotenv(ROOT / ".env")
    base_url = os.environ.get("KHRONIST_API_URL", "").strip()
    api_key = os.environ.get("ADMIN_API_KEY", "")
    if not base_url:
        print("Set KHRONIST_API_URL in the repository .env", file=sys.stderr)
        return 1
    if not api_key:
        print("Set ADMIN_API_KEY in the repository .env", file=sys.stderr)
        return 1
    try:
        client = AdminApiClient(base_url, api_key)
        sources, chunks, synonyms = ingest(
            client,
            KNOWLEDGE_ROOT / "data" / "entries",
            KNOWLEDGE_ROOT / "data" / "synonyms.yaml",
        )
    except (IngestError, ValidationError, ValueError) as error:
        print(f"Ingest failed: {error}", file=sys.stderr)
        return 1
    print(f"sources: {len(sources.items)}")
    print(
        "chunks: "
        f"inserted={chunks.inserted} updated={chunks.updated} "
        f"unchanged={chunks.unchanged} deleted={chunks.deleted}"
    )
    print(
        "synonyms: "
        f"inserted={synonyms.inserted} updated={synonyms.updated} "
        f"unchanged={synonyms.unchanged}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

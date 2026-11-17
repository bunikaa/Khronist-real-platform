import json
from pathlib import Path
from urllib.parse import urlsplit
from urllib.request import Request
from uuid import UUID

import pytest

from scripts.ingest import AdminApiClient, IngestError, ingest, split_article_text


class FakeResponse:
    def __init__(self, body: dict[str, object]) -> None:
        self.body = json.dumps(body).encode("utf-8")

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def read(self) -> bytes:
        return self.body


class FakeAdminApi:
    def __init__(self) -> None:
        self.requests: list[tuple[str, dict[str, object]]] = []
        self.run_number = 0

    def open(self, request: Request, timeout: int) -> FakeResponse:
        assert timeout == 30
        assert request.get_header("Authorization") == "Bearer local-test-key"
        route = urlsplit(request.full_url).path.rsplit("/", maxsplit=1)[-1]
        payload = json.loads(request.data or b"{}")
        self.requests.append((route, payload))
        if route == "sources":
            response = {
                "items": [
                    {"id": "123e4567-e89b-12d3-a456-426614174000", "url": item["url"]}
                    for item in payload["items"]
                ]
            }
        elif route == "chunks":
            self.run_number += 1
            response = {
                "inserted": len(payload["items"]) if self.run_number == 1 else 0,
                "updated": 0,
                "unchanged": 0 if self.run_number == 1 else len(payload["items"]),
                "deleted": 0,
            }
        else:
            response = {"inserted": 1, "updated": 0, "unchanged": 0}
        return FakeResponse(response)


def write_article(directory: Path, text: str) -> None:
    article = (
        "---\n"
        "term: тестовий термін\n"
        "variants: [тест]\n"
        "type: term\n"
        "period: XIX\n"
        "source_title: Тестове джерело\n"
        "source_url: https://example.org/source\n"
        "source_kind: dictionary\n"
        "licence: CC BY-SA 4.0\n"
        "---\n"
        f"{text}\n"
    )
    (directory / "test-article.md").write_text(article, encoding="utf-8")


def write_synonyms(path: Path) -> None:
    path.write_text(
        "synonyms:\n  - term: Іван\n    type: person\n    variants: [Иван]\n",
        encoding="utf-8",
    )


def test_splits_long_articles_into_two_or_three_overlapping_chunks() -> None:
    two_chunks = split_article_text("слово " * 251)
    three_chunks = split_article_text("слово " * 501)

    assert len(two_chunks) == 2
    assert len(three_chunks) == 3
    assert all(chunk.strip() for chunk in two_chunks + three_chunks)
    assert two_chunks[0][-100:] in two_chunks[1]
    assert three_chunks[1][-100:] in three_chunks[2]


def test_short_articles_remain_one_chunk() -> None:
    assert split_article_text("короткий текст") == ["короткий текст"]


def test_ingest_posts_full_payloads_in_order_and_repeats_idempotently(
    tmp_path: Path,
) -> None:
    entries = tmp_path / "entries"
    entries.mkdir()
    write_article(entries, "слово " * 251)
    synonyms_path = tmp_path / "synonyms.yaml"
    write_synonyms(synonyms_path)
    fake_api = FakeAdminApi()
    client = AdminApiClient("http://localhost:3000", "local-test-key", fake_api.open)

    first = ingest(client, entries, synonyms_path)
    second = ingest(client, entries, synonyms_path)

    assert [route for route, _ in fake_api.requests] == [
        "sources",
        "chunks",
        "synonyms",
        "sources",
        "chunks",
        "synonyms",
    ]
    chunks_payloads = [payload for route, payload in fake_api.requests if route == "chunks"]
    assert chunks_payloads[0] == chunks_payloads[1]
    chunk_items = chunks_payloads[0]["items"]
    assert all(item["sourceId"] == "123e4567-e89b-12d3-a456-426614174000" for item in chunk_items)
    assert all("wikidataId" not in item for item in chunk_items)
    synonym_items = next(
        payload["items"] for route, payload in fake_api.requests if route == "synonyms"
    )
    assert {item["type"] for item in synonym_items} == {"term", "person"}
    assert first[1].inserted == len(chunk_items)
    assert second[1].unchanged == len(chunk_items)
    assert second[1].deleted == 0
    assert first[0].items[0].id == UUID("123e4567-e89b-12d3-a456-426614174000")


def test_oversized_full_chunk_request_fails_before_http_calls(tmp_path: Path) -> None:
    entries = tmp_path / "entries"
    entries.mkdir()
    write_article(entries, "а" * 1_100_000)
    synonyms_path = tmp_path / "synonyms.yaml"
    write_synonyms(synonyms_path)
    fake_api = FakeAdminApi()
    client = AdminApiClient("http://localhost:3000", "local-test-key", fake_api.open)

    with pytest.raises(IngestError, match="API limit"):
        ingest(client, entries, synonyms_path)

    assert fake_api.requests == []

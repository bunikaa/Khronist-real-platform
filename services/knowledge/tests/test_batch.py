import base64
import hashlib
import io
import json
from pathlib import Path

import pytest
from PIL import Image
from pydantic import ValidationError

from khronist_knowledge.batch import (
    Box,
    Outcome,
    build_request,
    column_strips,
    crop_png,
    document_years,
    load_demo_pages,
    pixel_rect,
    render_summary,
)
from khronist_knowledge.scans import download


def test_column_strips_cut_the_two_form_columns() -> None:
    boxes = column_strips()
    assert len(boxes) == 6
    assert {(box.x, box.w) for box in boxes} == {(0.24, 0.28), (0.50, 0.22)}
    assert boxes[0].y == 0.25
    assert abs(boxes[2].y + boxes[2].h - 0.95) < 1e-9


def test_pixel_rect_joins_neighbouring_strips() -> None:
    upper, lower = Box(x=0, y=0, w=1, h=0.5), Box(x=0, y=0.5, w=1, h=0.5)
    assert pixel_rect(upper, 3000, 2481) == (0, 0, 3000, 1240)
    assert pixel_rect(lower, 3000, 2481)[1] == 1240


def test_document_years_reads_a_single_year_and_a_range() -> None:
    assert document_years("1896").model_dump() == {"yearFrom": 1896, "yearTo": 1896}
    assert document_years("1896–1897").model_dump() == {"yearFrom": 1896, "yearTo": 1897}


def test_build_request_follows_the_contract() -> None:
    png = b"\x89PNG fake bytes"
    request = build_request(
        fond="127",
        opys="1078",
        sprava="177",
        years="1896",
        image=4,
        viewer_url="https://archium.cdiak.archives.gov.ua/file-viewer/131976#file-2834611",
        box=Box(x=0, y=0, w=0.5, h=0.2),
        png=png,
    )
    body = request.model_dump()
    assert body["shelfmark"]["archive"] == "ЦДІАК України"
    assert body["shelfmark"]["portal"] == "archium"
    assert body["source"] == "batch"
    assert body["document"] == {"yearFrom": 1896, "yearTo": 1896}
    assert body["imageHash"] == hashlib.sha256(png).hexdigest()
    assert base64.b64decode(body["image"]["base64Png"]) == png


def test_build_request_rejects_an_impossible_year() -> None:
    with pytest.raises(ValidationError):
        document_years("896")


def test_crop_png_cuts_the_box_out_of_the_scan() -> None:
    scan = Image.new("RGB", (3000, 2481), "white")
    png = crop_png(scan, Box(x=0.5, y=0.2, w=0.5, h=0.2))
    with Image.open(io.BytesIO(png)) as fragment:
        assert fragment.format == "PNG"
        assert fragment.size == (1500, 496)


def test_load_demo_pages_flattens_files_in_order(tmp_path: Path) -> None:
    page = {"image": 4, "viewerUrl": "https://v/1", "imageUrl": "https://i/1.jpg", "imageId": 1}
    fund = {
        "files": [
            {"fond": "127", "opys": "1078", "sprava": "177", "years": "1896", "pages": [page]},
            {"fond": "127", "opys": "1078", "sprava": "1954", "years": "1884", "pages": [page]},
        ]
    }
    path = tmp_path / "pages.json"
    path.write_text(json.dumps(fund), encoding="utf-8")
    pages = load_demo_pages(path)
    assert [(file.sprava, page.image) for file, page in pages] == [("177", 4), ("1954", 4)]


def test_demo_fund_file_is_readable() -> None:
    pages = load_demo_pages(Path(__file__).parents[3] / "docs" / "demo-fund" / "pages.json")
    assert len(pages) == 100


def test_download_skips_a_scan_that_is_already_there(tmp_path: Path) -> None:
    target = tmp_path / "scan.jpg"
    target.write_bytes(b"cached")
    download("https://example.invalid/scan.jpg", target)
    assert target.read_bytes() == b"cached"


def test_render_summary_counts_reads_cache_and_failures() -> None:
    outcomes = [
        Outcome(sprava="177", image=4, strip=1, status="done", seconds=6.0),
        Outcome(sprava="177", image=4, strip=2, status="done", seconds=8.0),
        Outcome(sprava="177", image=4, strip=3, status="cached", seconds=0.2),
        Outcome(sprava="177", image=5, strip=1, status="failed", code="no_text", seconds=4.0),
    ]
    summary = render_summary("Пакетне читання", outcomes)
    assert "Зображень: 2, фрагментів: 4." in summary
    assert "Прочитано моделлю: 2, з кешу: 1, невдало: 1." in summary
    assert "Середній час прочитаного фрагмента: 7,0 с." in summary
    assert "| failed: no_text | 1 |" in summary

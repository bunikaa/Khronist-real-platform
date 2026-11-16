import base64
import hashlib
import io
import re
import statistics
from collections import Counter
from pathlib import Path
from typing import Literal

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field


class Box(BaseModel):
    model_config = ConfigDict(frozen=True)

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


FORM_COLUMNS: tuple[tuple[float, float], ...] = ((0.24, 0.28), (0.50, 0.22))
ROWS_TOP = 0.25
ROWS_BOTTOM = 0.95


def column_strips(
    columns: tuple[tuple[float, float], ...] = FORM_COLUMNS,
    top: float = ROWS_TOP,
    bottom: float = ROWS_BOTTOM,
    strips: int = 3,
) -> list[Box]:
    height = (bottom - top) / strips
    return [
        Box(x=x, y=top + strip * height, w=width, h=height)
        for x, width in columns
        for strip in range(strips)
    ]


def pixel_rect(box: Box, width: int, height: int) -> tuple[int, int, int, int]:
    left = round(box.x * width)
    top = round(box.y * height)
    right = round((box.x + box.w) * width)
    bottom = round((box.y + box.h) * height)
    return left, top, right, bottom


ARCHIVE = "ЦДІАК України"
YEAR_SEPARATOR = re.compile(r"\s*[–-]\s*")


class Shelfmark(BaseModel):
    model_config = ConfigDict(frozen=True)

    archive: str
    fond: str
    opys: str
    sprava: str
    image: int = Field(ge=1)
    portal: Literal["archium"] = "archium"
    portalUrl: str


class DocumentYears(BaseModel):
    model_config = ConfigDict(frozen=True)

    yearFrom: int = Field(ge=1000, le=2100)
    yearTo: int = Field(ge=1000, le=2100)


class PngImage(BaseModel):
    model_config = ConfigDict(frozen=True)

    base64Png: str = Field(min_length=1)


class RecognitionRequest(BaseModel):
    model_config = ConfigDict(frozen=True)

    shelfmark: Shelfmark
    image: PngImage
    box: Box
    imageHash: str = Field(pattern=r"^[a-f0-9]{64}$")
    source: Literal["batch"] = "batch"
    document: DocumentYears


def document_years(years: str) -> DocumentYears:
    parts = [int(part) for part in YEAR_SEPARATOR.split(years.strip())]
    return DocumentYears(yearFrom=parts[0], yearTo=parts[-1])


def build_request(
    *,
    fond: str,
    opys: str,
    sprava: str,
    years: str,
    image: int,
    viewer_url: str,
    box: Box,
    png: bytes,
) -> RecognitionRequest:
    return RecognitionRequest(
        shelfmark=Shelfmark(
            archive=ARCHIVE,
            fond=fond,
            opys=opys,
            sprava=sprava,
            image=image,
            portalUrl=viewer_url,
        ),
        image=PngImage(base64Png=base64.b64encode(png).decode("ascii")),
        box=box,
        imageHash=hashlib.sha256(png).hexdigest(),
        document=document_years(years),
    )


MAX_PNG_BYTES = 7 * 1024 * 1024
MAX_SIDE = 8000


class DemoPage(BaseModel):
    model_config = ConfigDict(frozen=True)

    image: int = Field(ge=1)
    viewerUrl: str
    imageUrl: str


class DemoFile(BaseModel):
    model_config = ConfigDict(frozen=True)

    fond: str
    opys: str
    sprava: str
    years: str
    pages: list[DemoPage]


class DemoFund(BaseModel):
    model_config = ConfigDict(frozen=True)

    files: list[DemoFile]


def load_demo_pages(path: Path) -> list[tuple[DemoFile, DemoPage]]:
    fund = DemoFund.model_validate_json(path.read_text(encoding="utf-8"))
    return [(file, page) for file in fund.files for page in file.pages]


def crop_png(scan: Image.Image, box: Box) -> bytes:
    fragment = scan.crop(pixel_rect(box, scan.width, scan.height))
    if max(fragment.size) > MAX_SIDE:
        raise ValueError(f"fragment {fragment.size} is larger than {MAX_SIDE} px")
    buffer = io.BytesIO()
    fragment.save(buffer, format="PNG")
    png = buffer.getvalue()
    if len(png) > MAX_PNG_BYTES:
        raise ValueError(f"fragment PNG is {len(png)} bytes, the limit is {MAX_PNG_BYTES}")
    return png


OutcomeStatus = Literal["done", "cached", "failed", "timeout", "error"]
FAILED_STATUSES = ("failed", "timeout", "error")


class Outcome(BaseModel):
    model_config = ConfigDict(frozen=True)

    sprava: str
    image: int
    strip: int
    status: OutcomeStatus
    code: str | None = None
    seconds: float


def decimal(value: float) -> str:
    return f"{value:.1f}".replace(".", ",")


def render_summary(title: str, outcomes: list[Outcome]) -> str:
    read = [outcome for outcome in outcomes if outcome.status == "done"]
    cached = [outcome for outcome in outcomes if outcome.status == "cached"]
    failures = Counter(
        f"{outcome.status}: {outcome.code or '—'}"
        for outcome in outcomes
        if outcome.status in FAILED_STATUSES
    )
    images = {(outcome.sprava, outcome.image) for outcome in outcomes}
    mean = statistics.mean(outcome.seconds for outcome in read) if read else 0.0
    failed = sum(failures.values())
    lines = [
        f"# {title}",
        "",
        f"Зображень: {len(images)}, фрагментів: {len(outcomes)}.",
        f"Прочитано моделлю: {len(read)}, з кешу: {len(cached)}, невдало: {failed}.",
        f"Середній час прочитаного фрагмента: {decimal(mean)} с.",
        "",
        "## Невдачі",
        "",
    ]
    if failures:
        lines += ["| Статус і код | Кількість |", "| --- | --- |"]
        lines += [f"| {key} | {count} |" for key, count in sorted(failures.items())]
    else:
        lines.append("Немає.")
    return "\n".join(lines) + "\n"

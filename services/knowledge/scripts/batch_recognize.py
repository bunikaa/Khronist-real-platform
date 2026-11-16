import argparse
import json
import os
import time
import urllib.error
import urllib.request
from datetime import date
from pathlib import Path
from typing import Literal

from PIL import Image
from pydantic import BaseModel

from khronist_knowledge.batch import (
    Outcome,
    OutcomeStatus,
    RecognitionRequest,
    build_request,
    column_strips,
    crop_png,
    load_demo_pages,
    render_summary,
)
from khronist_knowledge.scans import download

POLL_SECONDS = 3
WAIT_LIMIT_SECONDS = 240
DEFAULT_RETRY_SECONDS = 10

KNOWLEDGE = Path(__file__).resolve().parents[1]
PAGES = KNOWLEDGE.parents[1] / "docs" / "demo-fund" / "pages.json"
SCANS = KNOWLEDGE / "eval" / ".cache" / "scans"
STOP_STATUSES = (401, 503)


class Created(BaseModel):
    recognitionId: str
    status: Literal["queued", "cached"]


class Failure(BaseModel):
    code: str
    message: str


class State(BaseModel):
    recognitionId: str
    status: Literal["queued", "reading", "normalizing", "done", "failed"]
    error: Failure | None = None


class ApiError(Exception):
    def __init__(self, status: int, code: str) -> None:
        super().__init__(f"HTTP {status}: {code}")
        self.status = status
        self.code = code


def error_code(body: bytes) -> str:
    try:
        return str(json.loads(body)["error"]["code"])
    except (ValueError, KeyError, TypeError):
        return "unknown"


class Client:
    def __init__(self, base_url: str, key: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.key = key

    def call(self, method: str, path: str, body: bytes | None = None) -> bytes:
        while True:
            request = urllib.request.Request(
                self.base_url + path,
                data=body,
                method=method,
                headers={"Authorization": f"Bearer {self.key}", "Content-Type": "application/json"},
            )
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read()
            except urllib.error.HTTPError as error:
                if error.code == 429:
                    time.sleep(float(error.headers.get("retry-after") or DEFAULT_RETRY_SECONDS))
                    continue
                raise ApiError(error.code, error_code(error.read())) from error

    def create(self, request: RecognitionRequest) -> Created:
        body = request.model_dump_json().encode("utf-8")
        return Created.model_validate_json(self.call("POST", "/v1/recognitions", body))

    def wait(self, recognition_id: str) -> State:
        deadline = time.monotonic() + WAIT_LIMIT_SECONDS
        while True:
            state = State.model_validate_json(
                self.call("GET", f"/v1/recognitions/{recognition_id}")
            )
            if state.status in ("done", "failed") or time.monotonic() > deadline:
                return state
            time.sleep(POLL_SECONDS)


def recognize(client: Client, request: RecognitionRequest) -> tuple[OutcomeStatus, str | None]:
    try:
        created = client.create(request)
        if created.status == "cached":
            return "cached", None
        state = client.wait(created.recognitionId)
    except ApiError as error:
        if error.status in STOP_STATUSES:
            raise
        return "error", error.code
    if state.status == "failed":
        return "failed", state.error.code if state.error else None
    if state.status != "done":
        return "timeout", None
    return "done", None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start", type=int, default=1)
    parser.add_argument("--limit", type=int, default=2)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    client = Client(os.environ["KHRONIST_API_URL"], os.environ["KHRONIST_API_KEY"])
    first = args.start - 1
    pages = load_demo_pages(PAGES)[first : first + args.limit]
    outcomes: list[Outcome] = []
    stopped = ""
    try:
        for file, page in pages:
            scan_path = SCANS / page.imageUrl.rsplit("/", 1)[1]
            download(page.imageUrl, scan_path)
            with Image.open(scan_path) as scan:
                for strip, box in enumerate(column_strips(), start=1):
                    request = build_request(
                        fond=file.fond,
                        opys=file.opys,
                        sprava=file.sprava,
                        years=file.years,
                        image=page.image,
                        viewer_url=page.viewerUrl,
                        box=box,
                        png=crop_png(scan, box),
                    )
                    started = time.monotonic()
                    status, code = recognize(client, request)
                    outcome = Outcome(
                        sprava=file.sprava,
                        image=page.image,
                        strip=strip,
                        status=status,
                        code=code,
                        seconds=time.monotonic() - started,
                    )
                    outcomes.append(outcome)
                    label = f"{file.sprava}/{page.image}/{strip}"
                    print(f"{label}: {status} {code or ''} {outcome.seconds:.1f} s")

    except ApiError as error:
        stopped = str(error)
        print(f"stopped: {error}")
    finally:
        done_images = len({(outcome.sprava, outcome.image) for outcome in outcomes})
        last_image = first + done_images
        title = f"Пакетне читання {date.today().isoformat()}, зображення {args.start}–{last_image}"
        summary = render_summary(title, outcomes)
        if stopped:
            summary += f"\nЗупинено: {stopped}.\n"
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(summary, encoding="utf-8")
        print(args.out)


if __name__ == "__main__":
    main()

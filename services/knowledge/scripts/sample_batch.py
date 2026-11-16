import argparse
import json
import random
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image
from pydantic import BaseModel

from khronist_knowledge.batch import ARCHIVE, Box, crop_png, load_demo_pages
from khronist_knowledge.scans import download

KNOWLEDGE = Path(__file__).resolve().parents[1]
PAGES = KNOWLEDGE.parents[1] / "docs" / "demo-fund" / "pages.json"
SCANS = KNOWLEDGE / "eval" / ".cache" / "scans"
RUN_IMAGES = (range(21, 41), range(41, 61), range(81, 101))


class Summary(BaseModel):
    id: str


class Word(BaseModel):
    text: str
    uncertain: bool


class Line(BaseModel):
    words: list[Word]


class Transcription(BaseModel):
    id: str
    box: Box
    lines: list[Line]


def get_json(url: str) -> dict[str, object]:
    with urllib.request.urlopen(url, timeout=60) as response:
        return json.loads(response.read())


def marked(line: Line) -> str:
    return " ".join(f"⟦{w.text}⟧" if w.uncertain else w.text for w in line.words)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="https://api.khronist.org")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--seed", type=int, default=16)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    pages = load_demo_pages(PAGES)
    chosen = [pages[number - 1] for numbers in RUN_IMAGES for number in numbers]
    candidates: list[tuple[str, int, str, str]] = []
    for file, page in chosen:
        query = urllib.parse.urlencode(
            {
                "archive": ARCHIVE,
                "fond": file.fond,
                "opys": file.opys,
                "sprava": file.sprava,
                "image": page.image,
            }
        )
        found = get_json(f"{args.api}/v1/pages/lookup?{query}").get("page")
        if not isinstance(found, dict):
            continue
        for summary in found["transcriptions"]:
            candidates.append(
                (file.sprava, page.image, page.imageUrl, Summary.model_validate(summary).id)
            )

    sample = random.Random(args.seed).sample(candidates, args.count)
    args.out.mkdir(parents=True, exist_ok=True)
    report = [f"# Вибірка {args.count} фрагментів (seed {args.seed})\n"]
    for number, (sprava, image, image_url, transcription_id) in enumerate(sample, start=1):
        transcription = Transcription.model_validate(
            get_json(f"{args.api}/v1/transcriptions/{transcription_id}")
        )
        scan_path = SCANS / image_url.rsplit("/", 1)[1]
        download(image_url, scan_path)
        with Image.open(scan_path) as scan:
            png = crop_png(scan, transcription.box)
        picture = f"{number:02d}.png"
        (args.out / picture).write_bytes(png)
        report.append(f"## {number:02d}. Справа {sprava}, зображення {image}\n")
        report.append(f"`{transcription.id}`\n\n![]({picture})\n")
        report.extend(f"{index}. {marked(line)}" for index, line in enumerate(transcription.lines))
        report.append("")
    (args.out / "sample.md").write_text("\n".join(report), encoding="utf-8")
    print(args.out / "sample.md")


if __name__ == "__main__":
    main()

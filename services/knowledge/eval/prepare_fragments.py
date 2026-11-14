import json
import time
import urllib.request
from pathlib import Path

from PIL import Image

EVAL = Path(__file__).parent
FRAGMENTS = EVAL / "reference" / "fragments.jsonl"
SCANS = EVAL / ".cache" / "scans"
CROPS = EVAL / ".cache" / "fragments"


def download(url: str, target: Path) -> None:
    if target.exists():
        return
    request = urllib.request.Request(url, headers={"User-Agent": "khronist-eval/0.1"})
    with urllib.request.urlopen(request) as response:
        target.write_bytes(response.read())
    time.sleep(2)


def main() -> None:
    SCANS.mkdir(parents=True, exist_ok=True)
    CROPS.mkdir(parents=True, exist_ok=True)
    for line in FRAGMENTS.read_text(encoding="utf-8").splitlines():
        fragment = json.loads(line)
        scan = SCANS / fragment["imageUrl"].rsplit("/", 1)[1]
        download(fragment["imageUrl"], scan)
        image = Image.open(scan)
        width, height = image.size
        box = fragment["box"]
        left, top = round(box["x"] * width), round(box["y"] * height)
        right, bottom = left + round(box["w"] * width), top + round(box["h"] * height)
        image.crop((left, top, right, bottom)).save(CROPS / f"{fragment['fragment']}.png")
        print(fragment["fragment"], right - left, bottom - top)


if __name__ == "__main__":
    main()

import time
import urllib.request
from pathlib import Path

USER_AGENT = "khronist-eval/0.1"
PAUSE_SECONDS = 2


def download(url: str, target: Path) -> None:
    if target.exists():
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=60) as response:
        target.write_bytes(response.read())
    time.sleep(PAUSE_SECONDS)

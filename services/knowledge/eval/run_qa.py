import argparse
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from pydantic import ValidationError

from khronist_knowledge.corpus import CorpusError
from khronist_knowledge.qa import QaError, QaItem, load_qa
from khronist_knowledge.qa_report import Asked, ExplainReply, load_run, render, titles_to_articles

ATTEMPTS = 6
FALLBACK_WAIT_S = 7.0
TIMEOUT_S = 60.0


def retry_after(error: urllib.error.HTTPError) -> float:
    try:
        return max(float(error.headers.get("retry-after", "")), 1.0)
    except ValueError:
        return FALLBACK_WAIT_S


def explain(api: str, case: QaItem) -> ExplainReply | str:
    request = urllib.request.Request(
        f"{api}/v1/explain",
        data=json.dumps({"kind": case.kind, "text": case.text}).encode("utf-8"),
        headers={"content-type": "application/json"},
        method="POST",
    )
    for _ in range(ATTEMPTS):
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_S) as response:
                return ExplainReply.model_validate_json(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 429:
                time.sleep(retry_after(error))
                continue
            return f"HTTP {error.code}: {error.read().decode('utf-8', 'replace')[:300]}"
        except urllib.error.URLError as error:
            return f"no connection: {error.reason}"
        except TimeoutError:
            return f"no response in {TIMEOUT_S:.0f} s"
        except ValidationError as error:
            return f"response does not match the contract: {error}"
    return "HTTP 429: the rate limit did not clear"


def ask(args: argparse.Namespace) -> None:
    cases = [case for case in load_qa(args.qa) if case.mode == "explain"]
    api = args.api.rstrip("/")
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open("w", encoding="utf-8", newline="\n") as out:
        for case in cases:
            result = explain(api, case)
            if isinstance(result, str):
                asked = Asked(min_rank=args.min_rank, id=case.id, error=result)
            else:
                asked = Asked(min_rank=args.min_rank, id=case.id, reply=result)
            out.write(asked.model_dump_json() + "\n")
            print(case.id, "error" if asked.error else "ok", file=sys.stderr)
    print(args.out)


def report(args: argparse.Namespace) -> None:
    cases = load_qa(args.qa)
    runs = [load_run(path) for path in args.runs]
    text = render(args.qa.as_posix(), cases, runs, titles_to_articles(args.entries))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(text, encoding="utf-8", newline="\n")
    print(args.out)


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    ask_parser = commands.add_parser("ask")
    ask_parser.add_argument("--min-rank", required=True)
    ask_parser.add_argument("--qa", type=Path, default=Path("eval/qa.jsonl"))
    ask_parser.add_argument("--api", default="http://127.0.0.1:3000")
    ask_parser.add_argument("--out", type=Path, required=True)
    ask_parser.set_defaults(handler=ask)

    report_parser = commands.add_parser("report")
    report_parser.add_argument("--runs", type=Path, nargs="+", required=True)
    report_parser.add_argument("--qa", type=Path, default=Path("eval/qa.jsonl"))
    report_parser.add_argument("--entries", type=Path, default=Path("data/entries"))
    report_parser.add_argument("--out", type=Path, required=True)
    report_parser.set_defaults(handler=report)

    args = parser.parse_args()
    try:
        args.handler(args)
    except (QaError, CorpusError) as error:
        raise SystemExit(f"error: {error}") from error


if __name__ == "__main__":
    main()

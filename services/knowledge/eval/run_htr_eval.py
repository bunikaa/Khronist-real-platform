import argparse
from pathlib import Path

from khronist_knowledge.htr_report import (
    EvalError,
    evaluate,
    load_readings,
    load_reference,
    render,
)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reference", type=Path, required=True)
    parser.add_argument("--reference-reader")
    parser.add_argument("--readings", type=Path, nargs="+", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()

    references = load_reference(args.reference)
    try:
        results = evaluate(references, load_readings(args.readings))
    except EvalError as error:
        raise SystemExit(f"error: {error}") from error
    sources = [path.as_posix() for path in args.readings]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        render(references, results, sources, args.reference.as_posix(), args.reference_reader),
        encoding="utf-8",
        newline="\n",
    )
    print(args.out)


if __name__ == "__main__":
    main()

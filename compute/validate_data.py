"""Check a JSONL dataset against the output schema. Stdlib only, so it runs anywhere (CI included).

Usage:
    python validate_data.py data/seed.jsonl
    python validate_data.py data/synthetic.jsonl --drop-invalid data/synthetic.clean.jsonl
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from therapistgpt.safety import mentions_crisis  # noqa: E402
from therapistgpt.schema import SchemaError, validate  # noqa: E402

def check_row(row: dict) -> list[str]:
    problems = []
    if set(row) != {"input", "output"}:
        problems.append(f"row keys must be input and output, got {sorted(row)}")
        return problems
    if not isinstance(row["input"], str) or not row["input"].strip():
        problems.append("input must be a non-empty string")
    try:
        validate(row["output"])
    except SchemaError as exc:
        problems.append(str(exc))
        return problems
    # A crisis phrase with needs_support false is the most dangerous label error, so flag it loudly.
    if mentions_crisis(row["input"]) and not row["output"]["needs_support"]:
        problems.append("input contains a crisis phrase but needs_support is false")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("path", type=Path)
    parser.add_argument("--drop-invalid", type=Path, metavar="OUT", help="write only valid rows to OUT")
    args = parser.parse_args()

    if not args.path.exists():
        print(f"error: {args.path} does not exist", file=sys.stderr)
        return 2

    valid_rows, errors, stats = [], [], Counter()
    seen_inputs = set()
    with args.path.open(encoding="utf-8") as fh:
        for lineno, line in enumerate(fh, 1):
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append((lineno, f"invalid JSON: {exc}"))
                continue
            problems = check_row(row) if isinstance(row, dict) else ["row is not a JSON object"]
            key = row.get("input", "").strip().lower() if isinstance(row, dict) else ""
            if key and key in seen_inputs:
                problems.append("duplicate input")
            if problems:
                errors.extend((lineno, p) for p in problems)
                continue
            seen_inputs.add(key)
            valid_rows.append(row)
            stats["needs_support"] += row["output"]["needs_support"]

    for lineno, problem in errors[:50]:
        print(f"{args.path}:{lineno}: {problem}")
    if len(errors) > 50:
        print(f"... and {len(errors) - 50} more problems")

    print(f"{len(valid_rows)} valid rows, {len(errors)} problems, {stats['needs_support']} crisis rows")

    if args.drop_invalid:
        with args.drop_invalid.open("w", encoding="utf-8") as fh:
            for row in valid_rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        print(f"wrote {len(valid_rows)} rows to {args.drop_invalid}")
        return 0
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())

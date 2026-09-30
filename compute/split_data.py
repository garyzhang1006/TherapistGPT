"""Merge seed + synthetic rows, drop invalid ones, and write train/val/test splits.

Seed rows always go to train (they are the few-shot anchors of the teacher, so testing on them would leak).
Crisis rows are stratified so every split has some, because recall on those rows is the metric that matters most.

Usage:
    python split_data.py --inputs data/seed.jsonl data/synthetic.jsonl
"""

from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from validate_data import check_row  # noqa: E402

HERE = Path(__file__).resolve().parent


def load(path: Path) -> list[dict]:
    rows, bad = [], 0
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            bad += 1
            continue
        if isinstance(row, dict) and not check_row(row):
            rows.append(row)
        else:
            bad += 1
    print(f"{path}: {len(rows)} valid, {bad} dropped")
    return rows


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--inputs", nargs="+", type=Path, default=[HERE / "data" / "seed.jsonl", HERE / "data" / "synthetic.jsonl"])
    parser.add_argument("--out-dir", type=Path, default=HERE / "data")
    parser.add_argument("--val-frac", type=float, default=0.05)
    parser.add_argument("--test-frac", type=float, default=0.05)
    parser.add_argument("--seed", type=int, default=13)
    args = parser.parse_args()

    missing = [p for p in args.inputs if not p.exists()]
    if missing:
        print(f"error: missing input files {missing}. Run generate_synthetic.py first.", file=sys.stderr)
        return 2

    seed_path = (HERE / "data" / "seed.jsonl").resolve()
    anchors, pool, seen = [], [], set()
    for path in args.inputs:
        for row in load(path):
            key = row["input"].strip().lower()
            if key in seen:
                continue
            seen.add(key)
            (anchors if path.resolve() == seed_path else pool).append(row)

    rng = random.Random(args.seed)
    splits = {"train": list(anchors), "val": [], "test": []}
    for is_crisis in (True, False):
        group = [r for r in pool if r["output"]["needs_support"] is is_crisis]
        rng.shuffle(group)
        n_val = round(len(group) * args.val_frac)
        n_test = round(len(group) * args.test_frac)
        splits["val"] += group[:n_val]
        splits["test"] += group[n_val : n_val + n_test]
        splits["train"] += group[n_val + n_test :]

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for name, rows in splits.items():
        rng.shuffle(rows)
        out = args.out_dir / f"{name}.jsonl"
        with out.open("w", encoding="utf-8") as fh:
            for row in rows:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
        crisis = sum(r["output"]["needs_support"] for r in rows)
        print(f"{name}: {len(rows)} rows ({crisis} crisis) -> {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

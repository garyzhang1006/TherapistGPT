"""Score a model on the held-out test split. Run on a GPU box after training.

Usage:
    python evaluate.py --adapter outputs/therapistgpt-lora/final           # fine-tuned
    python evaluate.py --base-only                                         # untrained baseline, same prompt
    python evaluate.py --model your-hf-username/therapistgpt-1.5b          # a merged model on the Hub

Metrics (all deterministic, no LLM judge):
    valid_json        output parses as one JSON object
    valid_schema      output passes therapistgpt.schema.validate
    crisis_recall     share of crisis rows the MODEL flagged (before the keyword floor), with a 95% interval
    crisis_precision  share of model crisis flags that were real
    grounding         share of content words in thread points that appear in the brain dump
                      (low values mean the model is inventing things)
    feeling_overlap   Jaccard overlap of feeling words with the reference
    handwritten       crisis recall and false alarms on the 141 hand-written dumps in web/tests/fixtures
                      (44 crisis), for the model, the phrase list, and both together; see therapistgpt/handwritten.py
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from therapistgpt import handwritten  # noqa: E402
from therapistgpt.inference import Organizer  # noqa: E402
from therapistgpt.schema import SchemaError, extract_json, validate  # noqa: E402

HERE = Path(__file__).resolve().parent
STOPWORDS = set(
    "a an the and or but to of in on at for with you your i me my it is are was were be been "
    "that this they them he she we our about from as so not no do did does have has had".split()
)


def content_words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z']+", text.lower()) if w not in STOPWORDS and len(w) > 2}


def grounding(dump: str, output: dict) -> float:
    source = content_words(dump)
    words = set()
    for thread in output["threads"]:
        for point in thread["points"]:
            words |= content_words(point)
    return len(words & source) / len(words) if words else 1.0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--test", type=Path, default=HERE / "data" / "test.jsonl")
    parser.add_argument("--config", type=Path, default=HERE / "config.yaml")
    parser.add_argument("--model", help="model id or path; defaults to base_model from config")
    parser.add_argument("--adapter", help="LoRA adapter path or Hub id")
    parser.add_argument("--base-only", action="store_true", help="evaluate the untrained base model")
    parser.add_argument("--limit", type=int, default=0, help="only score the first N rows of each set")
    parser.add_argument(
        "--handwritten", type=Path, default=handwritten.FIXTURES, help="folder of hand-written brain-dumps*.json"
    )
    parser.add_argument("--report", type=Path, default=HERE / "outputs" / "eval_report.json")
    args = parser.parse_args()

    if not args.test.exists():
        print(f"error: {args.test} not found. Run split_data.py first.", file=sys.stderr)
        return 2
    if not (args.adapter or args.model or args.base_only):
        print("error: pass --adapter, --model, or --base-only", file=sys.stderr)
        return 2

    rows = [json.loads(line) for line in args.test.read_text(encoding="utf-8").splitlines() if line.strip()]
    if args.limit:
        rows = rows[: args.limit]
    # Checked before loading the model so an empty split fails in a second, not after a download.
    if not rows:
        print(f"error: {args.test} has no rows; generate synthetic data and rerun split_data.py", file=sys.stderr)
        return 2
    hand = handwritten.load(args.handwritten) if args.handwritten.is_dir() else []
    if not hand:
        print(f"warning: no hand-written dumps in {args.handwritten}, so the report has no handwritten block", file=sys.stderr)
    if args.limit:
        hand = hand[: args.limit]

    base = yaml.safe_load(args.config.read_text(encoding="utf-8"))["base_model"]
    organizer = Organizer(args.model or base, adapter=args.adapter)

    totals = {"valid_json": 0, "valid_schema": 0, "grounding": 0.0, "feeling_overlap": 0.0}
    tp = fp = fn = 0
    failures = []
    start = time.time()
    for i, row in enumerate(rows, 1):
        raw = organizer.generate_raw(row["input"])
        try:
            parsed = extract_json(raw)
            totals["valid_json"] += 1
            output = validate(parsed)
            totals["valid_schema"] += 1
        except SchemaError as exc:
            failures.append({"input": row["input"][:200], "error": str(exc), "raw": raw[:500]})
            output = None

        expected = row["output"]["needs_support"]
        predicted = bool(output and output["needs_support"])
        tp += expected and predicted
        fp += predicted and not expected
        fn += expected and not predicted

        if output:
            totals["grounding"] += grounding(row["input"], output)
            got = {f.lower() for f in output["feelings"]}
            want = {f.lower() for f in row["output"]["feelings"]}
            totals["feeling_overlap"] += len(got & want) / len(got | want) if got | want else 1.0
        if i % 20 == 0:
            print(f"{i}/{len(rows)} scored ({time.time() - start:.0f}s)")
    seconds_per_row = (time.time() - start) / max(len(rows), 1)

    # Output that fails the schema counts as not flagged, as it does for the test split above.
    hand_flags = []
    for i, row in enumerate(hand, 1):
        try:
            hand_flags.append(bool(validate(extract_json(organizer.generate_raw(row["input"])))["needs_support"]))
        except SchemaError:
            hand_flags.append(False)
        if i % 20 == 0:
            print(f"{i}/{len(hand)} hand-written scored")

    n = len(rows)
    ok = totals["valid_schema"]
    report = {
        "model": args.model or base,
        "adapter": args.adapter,
        "rows": n,
        "valid_json": totals["valid_json"] / n,
        "valid_schema": totals["valid_schema"] / n,
        "crisis_recall": tp / (tp + fn) if tp + fn else None,
        "crisis_recall_95ci": handwritten.wilson(tp, tp + fn),
        "crisis_precision": tp / (tp + fp) if tp + fp else None,
        # These only mean something on schema-valid rows. With none (a small split, an untrained model)
        # report None, like the crisis metrics, instead of a 0.0 that reads as "invented everything".
        "grounding": totals["grounding"] / ok if ok else None,
        "feeling_overlap": totals["feeling_overlap"] / ok if ok else None,
        "seconds_per_row": seconds_per_row,
        "handwritten": handwritten.crisis_scores(hand, hand_flags) if hand else None,
        "failures": failures[:20],
    }
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2), encoding="utf-8")
    for key, value in report.items():
        if key not in ("failures", "handwritten"):
            print(f"{key:>18}: {value:.3f}" if isinstance(value, float) else f"{key:>18}: {value}")
    if report["handwritten"]:
        print("hand-written dumps (the phrase list was tuned on these, so its row is a ceiling):")
        for name in ("model", "phrase_list_tuned_on_these", "model_plus_phrase_list"):
            scores = report["handwritten"][name]
            print(f"{name:>28}: crisis caught {scores['caught']} (95% CI {scores['recall_95ci']}), false alarms {scores['false_alarms']}")
    print(f"full report: {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

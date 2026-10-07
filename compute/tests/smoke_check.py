"""Checks for the CPU smoke run in .github/workflows/smoke.yml.

The smoke model is random and trained for two steps, so its output is noise. These checks prove the plumbing
instead: the eval report gets written, the merged model loads without peft, and the server keeps its contract.
Not named test_*.py on purpose, so the cheap unittest job in ci.yml never picks it up.

Usage (from compute/):
    python tests/smoke_check.py report outputs/smoke/eval_report.json
    python tests/smoke_check.py merged outputs/smoke/merged
    python tests/smoke_check.py serve outputs/smoke/merged
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))


def expect(ok: bool, message: str) -> None:
    # Not assert: python -O strips those, and a smoke check that can silently pass is worse than none.
    if not ok:
        raise SystemExit(f"smoke check failed: {message}")


def check_report(path: Path) -> None:
    expect(path.is_file(), f"{path} was not written")
    report = json.loads(path.read_text(encoding="utf-8"))
    expect(report.get("rows", 0) > 0, f"report scored no rows: {report.get('rows')}")
    for key in ("valid_json", "valid_schema"):
        expect(isinstance(report.get(key), float) and 0.0 <= report[key] <= 1.0, f"{key} is {report.get(key)!r}")
    expect(isinstance(report.get("failures"), list), "report has no failures list")
    # --limit 2 keeps one crisis and one calm hand-written dump, since load() alternates them.
    hand = report.get("handwritten") or {}
    expect(hand.get("rows", 0) > 0, f"report has no hand-written scores: {report.get('handwritten')!r}")
    for name in ("model", "phrase_list_tuned_on_these", "model_plus_phrase_list"):
        expect(isinstance(hand.get(name, {}).get("caught"), str), f"handwritten {name} is {hand.get(name)!r}")
    print(
        f"report ok: {report['rows']} rows, valid_json {report['valid_json']:.2f}, "
        f"{hand['rows']} hand-written, model caught {hand['model']['caught']}"
    )


def check_merged(path: Path) -> None:
    from transformers import AutoModelForCausalLM, AutoTokenizer

    # A merged model is a plain transformers checkpoint. Leftover adapter files would mean the merge was skipped.
    expect(not (path / "adapter_config.json").exists(), f"{path} still holds an adapter, not a merged model")
    model = AutoModelForCausalLM.from_pretrained(str(path))
    tokenizer = AutoTokenizer.from_pretrained(str(path))
    expect(tokenizer.chat_template is not None, "merged tokenizer lost its chat template")
    print(f"merged ok: {type(model).__name__}, {sum(p.numel() for p in model.parameters())} parameters")


def check_serve(path: Path) -> None:
    os.environ["MODEL_ID"] = str(path)
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:8000"
    for name in ("ADAPTER_ID", "API_KEY"):
        os.environ.pop(name, None)
    from fastapi.testclient import TestClient

    import serve

    # The with block runs the lifespan, which is where serve.py loads the model.
    with TestClient(serve.app) as client:
        health = client.get("/health")
        expect(
            health.status_code == 200 and health.json() == {"ok": True},
            f"/health said {health.status_code} {health.text}",
        )

        # A random model cannot write the schema, so this must take the documented unusable-output path:
        # a 502 the web app treats as "fall back to the on-device organizer".
        dump = "I have a test Friday and haven't started studying. I keep scrolling instead and feel awful about it."
        res = client.post("/organize", json={"text": dump})
        is_json = res.headers.get("content-type", "").startswith("application/json")
        detail = str(res.json().get("detail", "")) if is_json else ""
        expect(
            res.status_code == 502 and detail.startswith("model output was unusable"),
            f"/organize said {res.status_code} {res.text[:300]}",
        )

        # An oversized body is refused from its Content-Length, and the CORS layer still wraps the
        # refusal so a browser can read the status instead of seeing a network error.
        origin = "http://localhost:8000"
        big = client.post(
            "/organize",
            content=b"x" * (serve.MAX_BODY + 1),
            headers={"content-type": "application/json", "origin": origin},
        )
        expect(
            big.status_code == 413 and big.headers.get("access-control-allow-origin") == origin,
            f"oversized /organize said {big.status_code} with CORS {big.headers.get('access-control-allow-origin')!r}",
        )
    print("serve ok: /health true, /organize answered 502 for unusable output and 413 for an oversized body")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("check", choices=["report", "merged", "serve"])
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    {"report": check_report, "merged": check_merged, "serve": check_serve}[args.check](args.path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

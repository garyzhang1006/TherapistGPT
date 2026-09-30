"""Generate synthetic (brain dump -> organized JSON) pairs with Claude as the teacher model.

Runs anywhere with network access (Kaggle, Colab, a laptop): it only makes API calls, no GPU.
Needs ANTHROPIC_API_KEY in the environment (on Kaggle: Add-ons > Secrets).

Usage:
    python generate_synthetic.py --n 2000 --out data/synthetic.jsonl
    python generate_synthetic.py --n 2000 --out data/synthetic.jsonl   # rerun resumes where it stopped

Rough cost: each example is about 2.5k input and 1k output tokens, so 2,000 examples on
claude-opus-5-5 ($4 in / $20 out per million) is roughly $60. Try --n 20 first.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import anthropic
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent))

from therapistgpt.prompt import SYSTEM_PROMPT  # noqa: E402
from therapistgpt.schema import SchemaError, validate  # noqa: E402

HERE = Path(__file__).resolve().parent


class Thread(BaseModel):
    title: str
    points: list[str]


class ToDo(BaseModel):
    task: str
    first_step: str


class Reframe(BaseModel):
    thought: str
    reframe: str


class Organized(BaseModel):
    summary: str
    feelings: list[str]
    threads: list[Thread]
    to_dos: list[ToDo]
    kinder_view: list[Reframe]
    one_small_step: str
    needs_support: bool


class Example(BaseModel):
    brain_dump: str
    organized: Organized


WRITERS = [
    "a 16-year-old high school student", "a 19-year-old college freshman living away from home",
    "a 22-year-old grad student", "a 25-year-old retail worker", "a 28-year-old software engineer",
    "a 31-year-old nurse working night shifts", "a 34-year-old stay-at-home parent of two",
    "a 38-year-old single dad", "a 42-year-old teacher", "a 47-year-old recently divorced accountant",
    "a 55-year-old caring for an elderly parent", "a 63-year-old recently retired person",
    "a 20-year-old first-generation college student", "a 27-year-old freelance artist",
    "a 30-year-old who just moved to a new country", "a 45-year-old small business owner",
]
TOPICS = [
    "school deadlines", "a job they hate", "losing a job", "money and bills", "a breakup",
    "loneliness after moving", "family conflict", "a friendship fading", "grief after a death",
    "chronic pain or illness", "sleep problems", "body image", "parenting stress",
    "feeling like a failure compared to peers", "a messy home and undone chores",
    "starting or adjusting medication", "burnout", "a creative hobby that stopped feeling good",
    "caring for someone else", "holidays or a birthday that felt empty",
]
STYLES = [
    "all lowercase with almost no punctuation, one run-on paragraph",
    "short fragments separated by periods, flat tone",
    "long rambling sentences that jump between topics mid-sentence",
    "several typos and missing apostrophes, like typing fast on a phone",
    "a numbered-ish list that falls apart halfway through",
    "calm on the surface but with self-critical remarks slipped in",
    "very short, only two or three sentences",
    "written at 3am, anxious and looping back to the same worry",
]


def build_request(rng: random.Random, seeds: list[dict], crisis_rate: float) -> tuple[str, bool]:
    crisis = rng.random() < crisis_rate
    shots = rng.sample(seeds, k=min(2, len(seeds)))
    shot_text = "\n\n".join(
        f"Brain dump:\n{s['input']}\n\nOrganized:\n{json.dumps(s['output'], ensure_ascii=False)}" for s in shots
    )
    topics = rng.sample(TOPICS, k=rng.randint(1, 3))
    crisis_line = (
        "The writer also expresses, in their own indirect or direct words, thoughts of not wanting to live or of "
        "self-harm. Mark needs_support true and follow the crisis rules exactly. Do not describe any method."
        if crisis
        else "The writer is struggling but does not mention suicide, self-harm, or being in danger; needs_support is false."
    )
    prompt = f"""You are helping build training data for a small model that organizes brain dumps from people with depression.

Here is the organizer's system prompt, which defines the output rules:
<organizer_rules>
{SYSTEM_PROMPT}
</organizer_rules>

Here are two reference examples of the exact quality and format expected:
<examples>
{shot_text}
</examples>

Write ONE new, realistic brain dump and its organized version.
- Writer: {rng.choice(WRITERS)}
- On their mind: {", ".join(topics)}
- Writing style: {rng.choice(STYLES)}
- Length: about {rng.choice([25, 50, 80, 120, 180, 250])} words
- {crisis_line}

The brain dump must read like a real person typing to themselves, not like a writing exercise. Invent specific but ordinary details (names, days, small tasks). The organized version must follow every organizer rule, use only facts from the brain dump, and stay within the list limits."""
    return prompt, crisis


def generate_one(client: anthropic.Anthropic, model: str, prompt: str) -> dict | None:
    response = client.messages.parse(
        model=model,
        max_tokens=16000,
        messages=[{"role": "user", "content": prompt}],
        output_format=Example,
    )
    if response.stop_reason == "refusal":
        return None
    example = response.parsed_output
    row = {"input": example.brain_dump.strip(), "output": example.organized.model_dump()}
    validate(row["output"])
    return row


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=20, help="total rows wanted in --out (existing rows count)")
    parser.add_argument("--out", type=Path, default=HERE / "data" / "synthetic.jsonl")
    parser.add_argument("--seeds", type=Path, default=HERE / "data" / "seed.jsonl")
    parser.add_argument("--model", default="claude-opus-5-5")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--crisis-rate", type=float, default=0.08)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    seeds = [json.loads(line) for line in args.seeds.read_text(encoding="utf-8").splitlines() if line.strip()]
    if not seeds:
        print(f"error: no seed rows in {args.seeds}", file=sys.stderr)
        return 2

    done = 0
    if args.out.exists():
        done = sum(1 for line in args.out.read_text(encoding="utf-8").splitlines() if line.strip())
    todo = args.n - done
    if todo <= 0:
        print(f"{args.out} already has {done} rows, nothing to do")
        return 0
    print(f"generating {todo} rows with {args.model} ({done} already in {args.out})")

    client = anthropic.Anthropic(max_retries=5)
    # Offset the RNG by rows already written so a resumed run doesn't repeat the same prompts.
    rng = random.Random(args.seed + done)
    requests = [build_request(rng, seeds, args.crisis_rate) for _ in range(todo)]

    args.out.parent.mkdir(parents=True, exist_ok=True)
    lock = threading.Lock()
    written = failed = 0
    with args.out.open("a", encoding="utf-8") as fh, ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(generate_one, client, args.model, prompt): crisis for prompt, crisis in requests}
        for future in as_completed(futures):
            try:
                row = future.result()
            except (SchemaError, anthropic.APIStatusError, anthropic.APIConnectionError, ValueError) as exc:
                failed += 1
                print(f"skipped one example: {type(exc).__name__}: {exc}", file=sys.stderr)
                continue
            if row is None:
                failed += 1
                continue
            with lock:
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                fh.flush()
                written += 1
                if written % 25 == 0:
                    print(f"{written}/{todo} written, {failed} skipped")

    print(f"done: {written} written, {failed} skipped -> {args.out}")
    print("next: python validate_data.py", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Generate synthetic (brain dump -> organized JSON) pairs with an open-weights teacher on a GPU.

The same job as generate_synthetic.py for anyone without an Anthropic API key: it builds the same requests
(writers, topics, styles, crisis rate, two seed examples each) and runs them through a free model on the box
it runs on, by default Qwen2.5-7B-Instruct in float16 across both Kaggle T4s. That teacher is much weaker than
Claude, so more replies break the schema or flip the crisis label, and those are dropped; it keeps sampling
until --n rows are kept, --max-hours is spent, or it has tried three times as many requests as rows wanted.

Usage:
    python generate_open.py --n 1200 --out data/synthetic.jsonl
    python generate_open.py --n 1200 --out data/synthetic.jsonl   # rerun resumes where it stopped
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from generate_synthetic import build_request  # noqa: E402
from therapistgpt.schema import SchemaError, extract_json, validate  # noqa: E402

HERE = Path(__file__).resolve().parent

# build_request ends with the content rules; an open model also needs the exact reply shape spelled out,
# since there is no structured-output API to enforce it.
FORMAT = """

Reply with exactly one JSON object and nothing else, in this shape:
{"brain_dump": "<the brain dump>", "organized": {"summary": "...", "feelings": [...], "threads": [...], "to_dos": [...], "kinder_view": [...], "one_small_step": "...", "needs_support": true or false}}"""


def parse_reply(reply: str, crisis: bool) -> dict | None:
    """The training row in the reply, or None when it breaks the schema or the crisis label we asked for."""
    try:
        example = extract_json(reply)
        dump, organized = example["brain_dump"], example["organized"]
        if not isinstance(dump, str) or not dump.strip():
            return None
        validate(organized)
    except (SchemaError, KeyError, TypeError):
        return None
    # Same rule as generate_synthetic.generate_one: indirect crisis dumps often hold no keyword, so trust
    # the label we asked for and drop the row when the teacher disagreed.
    if organized["needs_support"] != crisis:
        return None
    return {"input": dump.strip(), "output": organized}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=1200, help="total rows wanted in --out (existing rows count)")
    parser.add_argument("--out", type=Path, default=HERE / "data" / "synthetic.jsonl")
    parser.add_argument("--seeds", type=Path, default=HERE / "data" / "seed.jsonl")
    parser.add_argument("--model", default="Qwen/Qwen2.5-7B-Instruct")
    parser.add_argument("--crisis-rate", type=float, default=0.08)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-new-tokens", type=int, default=1500)
    parser.add_argument(
        "--max-hours", type=float, default=5.0, help="start no new batch after this long, so a GPU session never cuts a run off"
    )
    args = parser.parse_args()
    start = time.time()

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

    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer

    # T4s have no bf16, which is what dtype="auto" would read from Qwen's config, and a 7B model in fp32 does
    # not fit two of them. CPU (the CI smoke run) gets fp32, since half-precision matmuls there are slow or missing.
    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    # Batched generation appends new tokens on the right, so prompts must be padded on the left.
    tokenizer.padding_side = "left"
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype, device_map="auto").train(False)
    print(f"generating {todo} rows with {args.model} ({done} already in {args.out}), loaded in {time.time() - start:.0f}s")

    # Offset the RNG by rows already written so a resumed run doesn't repeat the same prompts.
    rng = random.Random(args.seed + done)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    # A hard kill can leave a half-written last line; start on a fresh line so the next row isn't glued to it.
    if args.out.exists() and args.out.stat().st_size and not args.out.read_bytes().endswith(b"\n"):
        with args.out.open("a", encoding="utf-8") as fh:
            fh.write("\n")

    kept = dropped = tried = 0
    gen_start = time.time()
    # A teacher that keeps nothing in its first few batches (a wrong model id, fp16 overflow turning output into
    # noise) will keep nothing later either; stopping early saves the GPU hours.
    probe = max(64, args.batch_size * 4)
    with args.out.open("a", encoding="utf-8") as fh:
        while kept < todo and tried < 3 * todo:
            if time.time() - start > args.max_hours * 3600:
                print(f"stopping: --max-hours {args.max_hours} spent")
                break
            batch = [build_request(rng, seeds, args.crisis_rate) for _ in range(args.batch_size)]
            prompts = [
                tokenizer.apply_chat_template(
                    [{"role": "user", "content": prompt + FORMAT}], tokenize=False, add_generation_prompt=True
                )
                for prompt, _ in batch
            ]
            inputs = tokenizer(prompts, return_tensors="pt", padding=True).to(model.device)
            with torch.no_grad():
                out = model.generate(
                    **inputs,
                    max_new_tokens=args.max_new_tokens,
                    do_sample=True,  # varied dumps matter more than the single likeliest one
                    temperature=0.7,
                    top_p=0.95,
                    top_k=None,
                    # Qwen's generation_config sets a repetition penalty, which punishes the quotes and keys JSON must repeat.
                    repetition_penalty=1.0,
                    pad_token_id=tokenizer.pad_token_id,
                )
            replies = tokenizer.batch_decode(out[:, inputs["input_ids"].shape[1] :], skip_special_tokens=True)
            tried += len(batch)
            for reply, (_, crisis) in zip(replies, batch):
                row = parse_reply(reply, crisis)
                if row is None:
                    dropped += 1
                    continue
                if kept >= todo:
                    break
                fh.write(json.dumps(row, ensure_ascii=False) + "\n")
                fh.flush()
                kept += 1
            minutes = (time.time() - gen_start) / 60
            print(f"{kept}/{todo} kept, {dropped} dropped, {kept / max(minutes, 1e-6):.1f} rows/min", flush=True)
            if not kept and tried >= probe:
                print(f"error: kept 0 of the first {tried} replies; check --model and the dtype", file=sys.stderr)
                return 1

    print(f"done: {kept} written, {dropped} dropped of {tried} tried -> {args.out}")
    print("next: python validate_data.py", args.out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

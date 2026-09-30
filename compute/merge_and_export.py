"""Merge the LoRA adapter into the base model, save it, and optionally push it to the Hugging Face Hub.

A merged model loads without peft and is what serve.py and GGUF conversion expect.

Usage:
    python merge_and_export.py --adapter outputs/therapistgpt-lora/final --out outputs/therapistgpt-merged
    python merge_and_export.py --adapter outputs/therapistgpt-lora/final --push your-hf-username/therapistgpt-1.5b

Optional GGUF (for llama.cpp / Ollama), run on the same remote box afterwards:
    git clone --depth 1 https://github.com/ggml-org/llama.cpp
    pip install -r llama.cpp/requirements.txt
    python llama.cpp/convert_hf_to_gguf.py outputs/therapistgpt-merged --outtype q8_0 --outfile outputs/therapistgpt-q8_0.gguf
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

HERE = Path(__file__).resolve().parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--adapter", required=True, help="LoRA adapter path or Hub id")
    parser.add_argument("--config", type=Path, default=HERE / "config.yaml")
    parser.add_argument("--out", type=Path, default=HERE / "outputs" / "therapistgpt-merged")
    parser.add_argument("--push", metavar="HUB_ID", help="also upload the merged model to this Hub repo")
    parser.add_argument("--private", action="store_true", help="create the Hub repo as private")
    args = parser.parse_args()

    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    base_id = yaml.safe_load(args.config.read_text(encoding="utf-8"))["base_model"]
    adapter_path = Path(args.adapter)
    if not adapter_path.exists() and "/" not in args.adapter:
        print(f"error: adapter {args.adapter} is neither a local folder nor a Hub id", file=sys.stderr)
        return 2

    # Merge in fp16: the merged weights are shipped for inference, where fp16 is the common format.
    print(f"loading {base_id} and applying {args.adapter}")
    base = AutoModelForCausalLM.from_pretrained(base_id, dtype=torch.float16)
    merged = PeftModel.from_pretrained(base, args.adapter).merge_and_unload()
    tokenizer = AutoTokenizer.from_pretrained(args.adapter)

    args.out.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(str(args.out))
    tokenizer.save_pretrained(str(args.out))
    print(f"saved merged model to {args.out}")

    if args.push:
        merged.push_to_hub(args.push, private=args.private)
        tokenizer.push_to_hub(args.push, private=args.private)
        print(f"pushed to https://huggingface.co/{args.push}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

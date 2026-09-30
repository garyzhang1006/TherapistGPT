"""Fine-tune the base model with LoRA so it turns brain dumps into the TherapistGPT JSON.

Run on a GPU box (Kaggle T4, Colab, a cloud VM), never on a laptop CPU.

Usage:
    python train_lora.py --config config.yaml
    python train_lora.py --config config.yaml --dry-run   # format data and print one example, no model load
    python train_lora.py --config config.yaml --smoke     # 2 CPU steps on a tiny random model (CI plumbing check)
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))

from therapistgpt.prompt import build_messages  # noqa: E402

HERE = Path(__file__).resolve().parent
REQUIRED = {"base_model", "data", "lora", "train", "hub"}
# A 2-layer, randomly initialized Qwen2 that TRL's own test suite trains on. Its tokenizer ships the exact
# Qwen2.5 chat template, so assistant_only_loss takes the same patched-template path as the real run.
SMOKE_MODEL = "trl-internal-testing/tiny-Qwen2ForCausalLM-2.5"


def load_config(path: Path) -> dict:
    cfg = yaml.safe_load(path.read_text(encoding="utf-8"))
    missing = REQUIRED - set(cfg)
    unknown = set(cfg) - REQUIRED
    if missing or unknown:
        raise SystemExit(f"config error in {path}: missing {sorted(missing)}, unknown {sorted(unknown)}")
    return cfg


def load_split(path: Path):
    from datasets import load_dataset

    if not path.exists():
        raise SystemExit(f"{path} not found. Run generate_synthetic.py and split_data.py first.")
    ds = load_dataset("json", data_files=str(path), split="train")
    return ds.map(
        lambda row: {"messages": build_messages(row["input"], row["output"])},
        remove_columns=ds.column_names,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "config.yaml")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--smoke", action="store_true", help=f"train 2 steps of {SMOKE_MODEL} on CPU to prove the pipeline runs"
    )
    args = parser.parse_args()

    cfg = load_config(args.config)
    t = cfg["train"]
    base_model = cfg["base_model"]
    push = cfg["hub"]["push"]
    if args.smoke:
        base_model = SMOKE_MODEL
        push = False  # a random model must never reach the Hub
        # Not shorter: the system prompt and a seed dump alone come to roughly 650 tokens, and TRL drops rows
        # whose assistant turn is cut off entirely, which could leave nothing to train on.
        t = {**t, "output_dir": "outputs/smoke", "batch_size": 1, "grad_accum": 1, "max_length": 1024}
    train_ds = load_split(HERE / cfg["data"]["train"])
    val_path = HERE / cfg["data"]["val"]
    val_ds = load_split(val_path) if val_path.exists() and val_path.stat().st_size else None
    print(f"train rows: {len(train_ds)}, val rows: {len(val_ds) if val_ds else 0}")

    if args.dry_run:
        for message in train_ds[0]["messages"]:
            print(f"--- {message['role']} ---\n{message['content'][:600]}")
        return 0

    import torch
    from peft import LoraConfig
    from trl import SFTConfig, SFTTrainer

    if args.smoke:
        # Plain fp32 on CPU: fp16 AMP needs a GPU, and SFTConfig turns bf16 on unless told otherwise.
        use_bf16 = use_fp16 = False
        dtype = torch.float32
    else:
        if not torch.cuda.is_available():
            raise SystemExit("No CUDA GPU found. Run this on Kaggle/Colab/a GPU VM (see compute/README.md).")

        # T4s have no bf16. There we keep fp32 weights and let AMP run fp16 math, which avoids
        # the "Attempting to unscale FP16 gradients" error you get from fp16 weights.
        # is_bf16_supported() says yes on a T4 too (it counts slow emulation), so ask for sm_80+ directly.
        use_bf16 = torch.cuda.get_device_capability()[0] >= 8
        use_fp16 = not use_bf16
        dtype = torch.bfloat16 if use_bf16 else torch.float32

    lora = cfg["lora"]
    peft_config = LoraConfig(
        r=lora["r"],
        lora_alpha=lora["alpha"],
        lora_dropout=lora["dropout"],
        target_modules=lora["target_modules"],
        task_type="CAUSAL_LM",
    )

    has_val = val_ds is not None and len(val_ds) > 0
    sft_args = SFTConfig(
        output_dir=str(HERE / t["output_dir"]),
        num_train_epochs=t["epochs"],
        per_device_train_batch_size=t["batch_size"],
        per_device_eval_batch_size=t["batch_size"],
        gradient_accumulation_steps=t["grad_accum"],
        learning_rate=t["learning_rate"],
        lr_scheduler_type="cosine",
        warmup_steps=t["warmup"],
        max_length=t["max_length"],
        assistant_only_loss=True,
        gradient_checkpointing=True,
        bf16=use_bf16,
        fp16=use_fp16,
        model_init_kwargs={"dtype": dtype},
        logging_steps=t["logging_steps"],
        eval_strategy="steps" if has_val else "no",
        eval_steps=t["eval_steps"],
        save_strategy="steps",
        save_steps=t["save_steps"],
        save_total_limit=2,
        load_best_model_at_end=has_val,
        report_to="none",
        seed=t["seed"],
        push_to_hub=push,
        hub_model_id=cfg["hub"]["model_id"] if push else None,
        # max_steps overrides num_train_epochs when positive; -1 is the TrainingArguments default.
        max_steps=2 if args.smoke else -1,
    )

    trainer = SFTTrainer(
        model=base_model,
        args=sft_args,
        train_dataset=train_ds,
        eval_dataset=val_ds if has_val else None,
        peft_config=peft_config,
    )
    trainer.train()

    final_dir = HERE / t["output_dir"] / "final"
    # Not trainer.save_model(): with push_to_hub on, it also calls trainer.push_to_hub(), which uploads all of
    # output_dir, final/ included (transformers 5.17.0 trainer.py, end of save_model).
    trainer.model.save_pretrained(str(final_dir))
    trainer.processing_class.save_pretrained(str(final_dir))
    print(f"saved LoRA adapter to {final_dir}")
    if push:
        # Push the adapter alone, for the same reason as above.
        trainer.model.push_to_hub(cfg["hub"]["model_id"], commit_message="Final TherapistGPT LoRA adapter")
        trainer.processing_class.push_to_hub(cfg["hub"]["model_id"])
        print(f"pushed adapter to https://huggingface.co/{cfg['hub']['model_id']}")
    print("next: python evaluate.py --adapter", final_dir, *(["--model", SMOKE_MODEL] if args.smoke else []))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

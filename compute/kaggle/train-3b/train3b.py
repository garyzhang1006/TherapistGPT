# Kaggle GPU kernel: the same training run as therapistgpt-train-v2 on Qwen2.5-3B-Instruct, to see whether the
# bigger model is worth its cost. Untrained, the 3B caught 16 of 44 hand-written crisis dumps against 4 for the
# 1.5B. Its weights stay in fp32 on a T4 (see train_lora.py), about 12 GB, which leaves no room to train on one
# 16 GB card, so training splits the layers across both T4s. Scoring fits on one. No merge: the adapter is
# enough to compare, and merging is cheap to do later if the 3B wins.
#
# It runs beside train-v2 on a 30 h/week GPU quota that must still cover the serving session, so it is capped:
# one epoch, training stopped after TRAIN_HOURS, and scoring on the same 88 hand-written dumps (44 crisis,
# 44 calm) the untrained 3B was scored on. A capped run says whether the 3B learns faster, not where it ends up.
import glob
import os
import shutil
import subprocess
import sys

REPO = "/tmp/TherapistGPT"
OUT = "/kaggle/working/therapistgpt-3b"
SPLITS = ("train.jsonl", "val.jsonl", "test.jsonl")
ONE_GPU = {**os.environ, "CUDA_VISIBLE_DEVICES": "0"}
TRAIN_HOURS = 2.25
# Put into train_lora.py just before trainer.train(). With should_training_stop set, Trainer ends the epoch
# loop, loads the best checkpoint by eval loss, and returns normally, so the adapter is still saved to final/.
TIME_CAP = f"""    import time
    from transformers import TrainerCallback

    class StopAfter(TrainerCallback):
        deadline = time.time() + {TRAIN_HOURS} * 3600

        def on_step_end(self, args, state, control, **kwargs):
            if time.time() > self.deadline:
                print(f"time cap: stopping at step {{state.global_step}} of {{state.max_steps}}", flush=True)
                control.should_training_stop = True

    trainer.add_callback(StopAfter())
    trainer.train()
"""


def run(*args, env=None):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True, env=env or ONE_GPU)


def edit(path, old, new):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    if old not in text:
        raise SystemExit(f"{path} no longer contains {old!r}; update this kernel")
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text.replace(old, new))


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
# Kaggle ships torchao 0.10.0, and peft 0.21.1 raises ImportError on any torchao older than 0.16.
run(sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao")
os.makedirs(f"{OUT}/data", exist_ok=True)

batches = sorted(glob.glob("/kaggle/input/**/synthetic-*.clean.jsonl", recursive=True))
print("batches:", batches, flush=True)
if len(batches) != 2:
    raise SystemExit(f"expected 2 synthetic-*.clean.jsonl batches under /kaggle/input, found {batches}")
for i, path in enumerate(batches):
    shutil.copy(path, f"data/batch{i}.clean.jsonl")
# Same inputs and split seed as train-v2, so both models see the same rows and are scored on the same test split.
run(sys.executable, "split_data.py", "--inputs", "data/seed.jsonl", "data/batch0.clean.jsonl", "data/batch1.clean.jsonl")
for name in SPLITS:
    shutil.copy(f"data/{name}", f"{OUT}/data/")

shutil.copy("config.yaml", "config-3b.yaml")
edit("config-3b.yaml", "base_model: Qwen/Qwen2.5-1.5B-Instruct", "base_model: Qwen/Qwen2.5-3B-Instruct")
edit("config-3b.yaml", "output_dir: outputs/therapistgpt-lora", "output_dir: outputs/therapistgpt-3b-lora")
# Same effective batch of 16, one row per step: plain nll (below) holds the full logits, about 1.2 GB
# per 2,048-token row in fp32 plus its gradient, on the first card.
edit("config-3b.yaml", "batch_size: 4", "batch_size: 1")
edit("config-3b.yaml", "grad_accum: 4 ", "grad_accum: 16 ")
# "balanced" spreads the layers evenly over both cards. Trainer sees a model on two devices, so it skips
# DataParallel (transformers 5.17.0 trainer.py, "Distributed strategy").
edit("train_lora.py", 'model_init_kwargs={"dtype": dtype}', 'model_init_kwargs={"dtype": dtype, "device_map": "balanced"}')
# trl 1.14.1 defaults to chunked_nll, which bypasses the root module's device hook and indexes the last
# layers' hidden states (second card) with labels on the first. Plain nll runs the hooked forward, which
# returns the logits on the input device, beside the labels.
edit("train_lora.py", "assistant_only_loss=True,", 'assistant_only_loss=True, loss_type="nll",')
edit("config-3b.yaml", "epochs: 3", "epochs: 1")
edit("train_lora.py", "    trainer.train()\n", TIME_CAP)
print(open("config-3b.yaml", encoding="utf-8").read(), flush=True)

run(sys.executable, "train_lora.py", "--config", "config-3b.yaml", env=dict(os.environ))
shutil.copytree("outputs/therapistgpt-3b-lora/final", f"{OUT}/adapter", dirs_exist_ok=True)
run(sys.executable, "evaluate.py", "--config", "config-3b.yaml", "--adapter", f"{OUT}/adapter",
    "--limit", "88", "--report", f"{OUT}/eval_finetuned_3b.json")

with open(f"{OUT}/eval_finetuned_3b.json", encoding="utf-8") as fh:
    print(fh.read())

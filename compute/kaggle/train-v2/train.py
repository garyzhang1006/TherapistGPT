# Kaggle GPU kernel: trains TherapistGPT on both batches of open-teacher data. It reads the validated rows that
# therapistgpt-gpu-train and therapistgpt-gpu-data2 wrote, uploaded as the private dataset therapistgpt-data
# (Kaggle refuses an errored kernel as a source), re-splits them with the seed rows, trains the LoRA adapter,
# scores it on the full test split and all 141 hand-written dumps, and merges it. The base model was already
# scored by the earlier kernels.
import glob
import os
import shutil
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
OUT = "/kaggle/working/therapistgpt"
SPLITS = ("train.jsonl", "val.jsonl", "test.jsonl")
# Multi-GPU DataParallel does not help a 1.5B LoRA run and complicates gradient checkpointing (as in the notebook).
ONE_GPU = {**os.environ, "CUDA_VISIBLE_DEVICES": "0"}


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True, env=ONE_GPU)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
# Kaggle ships torchao 0.10.0, and peft 0.21.1 raises ImportError on any torchao older than 0.16 while it wraps
# the model. Nothing here uses torchao, and peft skips it when it is absent. This killed the first training run.
run(sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao")
os.makedirs(f"{OUT}/data", exist_ok=True)

# Kaggle mounts inputs under /kaggle/input with a path that has changed before, so search for the files.
batches = sorted(glob.glob("/kaggle/input/**/synthetic-*.clean.jsonl", recursive=True))
print("batches:", batches, flush=True)
if len(batches) != 2:
    raise SystemExit(f"expected 2 synthetic-*.clean.jsonl batches under /kaggle/input, found {batches}")
for i, path in enumerate(batches):
    shutil.copy(path, f"data/batch{i}.clean.jsonl")
run(sys.executable, "split_data.py", "--inputs", "data/seed.jsonl", "data/batch0.clean.jsonl", "data/batch1.clean.jsonl")
for name in SPLITS:
    shutil.copy(f"data/{name}", f"{OUT}/data/")

run(sys.executable, "train_lora.py", "--config", "config.yaml")
# Checkpoints stay in the clone: the final adapter is what evaluate.py, merge and serve.py load.
shutil.copytree("outputs/therapistgpt-lora/final", f"{OUT}/adapter", dirs_exist_ok=True)
run(sys.executable, "evaluate.py", "--adapter", f"{OUT}/adapter", "--report", f"{OUT}/eval_finetuned.json")
run(sys.executable, "merge_and_export.py", "--adapter", f"{OUT}/adapter", "--out", f"{OUT}/merged")

with open(f"{OUT}/eval_finetuned.json", encoding="utf-8") as fh:
    print(fh.read())

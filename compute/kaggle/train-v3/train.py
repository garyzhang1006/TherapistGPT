# Kaggle GPU kernel: the v3 fine-tune of TherapistGPT (Qwen2.5-1.5B-Instruct, same config as train-v2) on all
# the open-teacher data: synthetic-a and synthetic-b from the private dataset therapistgpt-data, the
# crisis-heavy third batch (crisis rate 0.25) that therapistgpt-gpu-data3 wrote, attached as a kernel source,
# and the CPU kernels' rows (3B teacher, crisis rate 0.3) from the private dataset therapistgpt-cpu-rows.
# The extra crisis rows are the point of this run: train-v2 caught 11 of 44 hand-written crisis dumps.
# It re-splits everything with the seed rows, trains the LoRA adapter, scores it on the full test split and all
# 141 hand-written dumps, and merges it for the serving kernel. train-v2 took 3.1 hours on 3,431 rows.
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
# The dataset holds synthetic-a/b.clean.jsonl and the gpu-data3 output holds synthetic.clean.jsonl.
batches = sorted(glob.glob("/kaggle/input/**/synthetic*.clean.jsonl", recursive=True))
print("batches:", batches, flush=True)
if len(batches) != 3 or not any(os.path.basename(path) == "synthetic.clean.jsonl" for path in batches):
    raise SystemExit(
        f"expected synthetic-a/b.clean.jsonl from therapistgpt-data and synthetic.clean.jsonl from "
        f"therapistgpt-gpu-data3 under /kaggle/input, found {batches}"
    )
for i, path in enumerate(batches):
    shutil.copy(path, f"data/batch{i}.clean.jsonl")
inputs = [f"data/batch{i}.clean.jsonl" for i in range(len(batches))]
# Rows from the CPU kernels (3B teacher) arrive raw in the therapistgpt-cpu-rows dataset, and a session cut at
# 12 hours can leave a half-written last line, so they are validated here.
raw = sorted(glob.glob("/kaggle/input/**/cpu-*.jsonl", recursive=True))
print("cpu rows:", raw, flush=True)
for i, path in enumerate(raw):
    run(sys.executable, "validate_data.py", path, "--drop-invalid", f"data/cpu{i}.clean.jsonl")
    inputs.append(f"data/cpu{i}.clean.jsonl")
run(sys.executable, "split_data.py", "--inputs", "data/seed.jsonl", *inputs)
for name in SPLITS:
    shutil.copy(f"data/{name}", f"{OUT}/data/")

run(sys.executable, "train_lora.py", "--config", "config.yaml")
# Checkpoints stay in the clone: the final adapter is what evaluate.py, merge and serve.py load.
shutil.copytree("outputs/therapistgpt-lora/final", f"{OUT}/adapter", dirs_exist_ok=True)
run(sys.executable, "evaluate.py", "--adapter", f"{OUT}/adapter", "--report", f"{OUT}/eval_finetuned.json")
run(sys.executable, "merge_and_export.py", "--adapter", f"{OUT}/adapter", "--out", f"{OUT}/merged")

with open(f"{OUT}/eval_finetuned.json", encoding="utf-8") as fh:
    print(fh.read())

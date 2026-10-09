# Kaggle GPU kernel: the whole TherapistGPT pipeline in one "GPU T4 x2" session, with no API key.
# Writes the training data with an open teacher (compute/generate_open.py) on both GPUs, then validates and
# splits it, scores the base model, trains the LoRA adapter, scores it, and merges it. Data, reports, the
# adapter and the merged model go to /kaggle/working, which Kaggle saves as the kernel's output. Nothing goes
# to the Hub. Attach the output of an earlier run as an input and the data step is skipped.
import glob
import os
import shutil
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
OUT = "/kaggle/working/therapistgpt"
SPLITS = ("train.jsonl", "val.jsonl", "test.jsonl")

# The teacher needs both GPUs to hold a 7B model in fp16. Everything after it uses one: multi-GPU DataParallel
# does not help a 1.5B LoRA run and complicates gradient checkpointing (as in the notebook).
ONE_GPU = {**os.environ, "CUDA_VISIBLE_DEVICES": "0"}


def run(*args, env=None):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True, env=env or ONE_GPU)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
# Kaggle ships torchao 0.10.0, and peft 0.21.1 raises ImportError on any torchao older than 0.16 while it wraps
# the model. The first run of this kernel died at train_lora.py without this line; its data still fed train-v2.
run(sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao")
os.makedirs(f"{OUT}/data", exist_ok=True)

# Kaggle mounts inputs under /kaggle/input with a path that has changed before, so search for the files.
earlier = {name: sorted(glob.glob(f"/kaggle/input/**/{name}", recursive=True)) for name in SPLITS}
if all(earlier.values()):
    for name, found in earlier.items():
        shutil.copy(found[0], f"data/{name}")
        print(f"using {found[0]}", flush=True)
else:
    generate = (sys.executable, "generate_open.py", "--n", "1200", "--out", "data/synthetic.jsonl")
    try:
        run(*generate, "--max-hours", "5", env=dict(os.environ))
    except subprocess.CalledProcessError:
        # Qwen2.5 can overflow in fp16 (see therapistgpt/inference.py), which generate_open.py's early check turns
        # into a quick exit. A second try with a smaller model from another family resumes from the rows kept.
        run(*generate, "--max-hours", "4.5", "--model", "microsoft/Phi-3.5-mini-instruct", env=dict(os.environ))
    run(sys.executable, "validate_data.py", "data/synthetic.jsonl", "--drop-invalid", "data/synthetic.clean.jsonl")
    run(sys.executable, "split_data.py", "--inputs", "data/seed.jsonl", "data/synthetic.clean.jsonl")
# Saved before training, so the hours the teacher spent survive a later failure and can feed a rerun.
for path in glob.glob("data/synthetic*.jsonl") + [f"data/{name}" for name in SPLITS]:
    shutil.copy(path, f"{OUT}/data/")

run(sys.executable, "evaluate.py", "--base-only", "--limit", "50", "--report", f"{OUT}/eval_base.json")
run(sys.executable, "train_lora.py", "--config", "config.yaml")
# Checkpoints stay in the clone: the final adapter is what evaluate.py, merge and serve.py load.
shutil.copytree("outputs/therapistgpt-lora/final", f"{OUT}/adapter", dirs_exist_ok=True)
run(sys.executable, "evaluate.py", "--adapter", f"{OUT}/adapter", "--report", f"{OUT}/eval_finetuned.json")
run(sys.executable, "merge_and_export.py", "--adapter", f"{OUT}/adapter", "--out", f"{OUT}/merged")

for report in ("eval_base.json", "eval_finetuned.json"):
    print(f"===== {report} =====")
    with open(f"{OUT}/{report}", encoding="utf-8") as fh:
        print(fh.read())

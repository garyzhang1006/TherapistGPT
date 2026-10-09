# Kaggle CPU kernel: more crisis-heavy training rows from the 3B open teacher, written on a free CPU session and
# resumed across Kaggle's 12-hour CPU limit. The rows so far live in the private dataset therapistgpt-cpu-rows
# (cpu-a/b/c.jsonl, refreshed from each run's output before the next push). This run copies its file into
# /kaggle/working and generate_open.py appends to it, so every run's output holds all of that kernel's rows.
# The 7B teacher needs about 30 GB in fp32, more than a CPU session holds, so this uses the 3B (fp32 on CPU).
# The crisis rate is 0.3 because crisis wording is where the fine-tunes are weakest.
import glob
import os
import shutil
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
OUT = "/kaggle/working/therapistgpt/data"
# Pushed three times, as therapistgpt-cpu-data-a/b/c with NAME a/b/c and SEED 2000/3000/4000.
NAME = "a"
# generate_open.py seeds its RNG with --seed plus the rows already written, so seeds far apart keep the three
# kernels (and the first runs, seeds 2/3/4) from ever drawing the same prompts.
SEED = "2000"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
os.makedirs(OUT, exist_ok=True)

# Kaggle mounts inputs under /kaggle/input with a path that has changed before, so search for the file.
saved = glob.glob(f"/kaggle/input/**/cpu-{NAME}.jsonl", recursive=True)
print("rows so far:", saved, flush=True)
if len(saved) != 1:
    raise SystemExit(f"expected one cpu-{NAME}.jsonl from the therapistgpt-cpu-rows dataset under /kaggle/input, found {saved}")
shutil.copy(saved[0], f"{OUT}/synthetic.jsonl")

# Batches of 4: the first runs used 16, a batch took 3 to 6 hours on CPU, and the 12-hour cut threw away the
# batch in flight. Rows are flushed one at a time and Kaggle kept /kaggle/working when it cut those sessions,
# so a cut now loses at most one short batch. --n is past what a CPU can write, so --max-hours ends the run.
run(
    sys.executable, "generate_open.py", "--model", "Qwen/Qwen2.5-3B-Instruct", "--seed", SEED, "--crisis-rate", "0.3",
    "--n", "2000", "--batch-size", "4", "--out", f"{OUT}/synthetic.jsonl", "--max-hours", "10.5",
)
run(sys.executable, "validate_data.py", f"{OUT}/synthetic.jsonl", "--drop-invalid", f"{OUT}/synthetic.clean.jsonl")

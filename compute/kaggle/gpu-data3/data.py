# Kaggle GPU kernel: a third batch of training data from the 7B open teacher, for the next fine-tune after the
# 2026-10-10 quota reset. The first push was deleted an hour in to free a GPU slot. This rerun is sized to the
# 2.91 GPU hours left this week, on the guess that Kaggle stops a session when the quota runs out, so
# generation stops starting new batches after 2.1 hours (setup takes about 5 minutes, a batch about 3). The
# guess was wrong: on 2026-10-09 running GPU sessions kept going until 38.65 of the 30 hours were used. The
# crisis rate is raised from 0.08 to 0.25 because crisis wording is what both fine-tunes miss most (11 and 14
# of 44 hand-written crisis dumps).
import os
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
OUT = "/kaggle/working/therapistgpt/data"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
os.makedirs(OUT, exist_ok=True)

# Rows go straight into /kaggle/working, so they are kept even if the session ends early.
generate = (
    sys.executable, "generate_open.py", "--seed", "5", "--crisis-rate", "0.25", "--n", "2400",
    "--out", f"{OUT}/synthetic.jsonl",
)
try:
    run(*generate, "--max-hours", "2.1")
except subprocess.CalledProcessError:
    # Qwen2.5 can overflow in fp16 (see therapistgpt/inference.py), which generate_open.py's early check turns
    # into a quick exit after 64 replies (about 15 minutes). A second try with a smaller model from another
    # family resumes from the rows kept, capped so both tries together stay inside the quota.
    run(*generate, "--max-hours", "1.6", "--model", "microsoft/Phi-3.5-mini-instruct")
run(sys.executable, "validate_data.py", f"{OUT}/synthetic.jsonl", "--drop-invalid", f"{OUT}/synthetic.clean.jsonl")

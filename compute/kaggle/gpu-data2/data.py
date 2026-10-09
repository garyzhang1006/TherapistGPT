# Kaggle GPU kernel: a second, longer batch of training data from the same open teacher, written in parallel
# with therapistgpt-gpu-train. A different --seed gives different prompts, so a later training run can merge
# both batches for roughly twice the rows. Data only; the rows are saved to /kaggle/working as they validate.
import os
import shutil
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

# A 12-hour session minus setup and the validation step; no training here, so the teacher gets the time.
generate = (sys.executable, "generate_open.py", "--seed", "1", "--n", "2400", "--out", "data/synthetic.jsonl")
try:
    run(*generate, "--max-hours", "9.5")
except subprocess.CalledProcessError:
    # Qwen2.5 can overflow in fp16 (see therapistgpt/inference.py), which generate_open.py's early check turns
    # into a quick exit. A second try with a smaller model from another family resumes from the rows kept.
    run(*generate, "--max-hours", "9", "--model", "microsoft/Phi-3.5-mini-instruct")
finally:
    if os.path.exists("data/synthetic.jsonl"):
        shutil.copy("data/synthetic.jsonl", OUT)
run(sys.executable, "validate_data.py", "data/synthetic.jsonl", "--drop-invalid", "data/synthetic.clean.jsonl")
shutil.copy("data/synthetic.clean.jsonl", OUT)

# Kaggle CPU kernel: score the untrained Qwen2.5-1.5B-Instruct with TherapistGPT's own prompt on the 12 seed
# brain dumps and the 141 hand-written dumps in web/tests/fixtures (44 of them crisis), so the fine-tuned
# model has a baseline to beat. No GPU needed; at roughly a minute per dump on CPU it takes a few hours.
import os
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
REPORT = "/kaggle/working/eval_base_cpu.json"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
# The seed rows stand in for a test split, which needs synthetic data; evaluate.py adds the hand-written dumps itself.
run(sys.executable, "evaluate.py", "--base-only", "--test", "data/seed.jsonl", "--report", REPORT)
with open(REPORT, encoding="utf-8") as report:
    print(report.read())

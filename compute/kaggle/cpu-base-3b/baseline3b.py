# Kaggle CPU kernel: score the untrained Qwen2.5-3B-Instruct, twice the size of the model TherapistGPT
# fine-tunes, on the seed rows and the hand-written dumps. If a bigger base model already catches most crisis
# wordings, the next fine-tune should start from it. --limit 88 keeps all 44 hand-written crisis dumps and 44
# calm ones (handwritten.load alternates them), so the run fits a 12-hour CPU session.
import os
import subprocess
import sys

# Cloned outside /kaggle/working, which Kaggle saves as the output, so only the results are kept.
REPO = "/tmp/TherapistGPT"
REPORT = "/kaggle/working/eval_base_3b_cpu.json"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
os.chdir(f"{REPO}/compute")
run(sys.executable, "-m", "pip", "install", "-q", "-r", "requirements.txt")
run(
    sys.executable, "evaluate.py", "--base-only", "--model", "Qwen/Qwen2.5-3B-Instruct", "--test", "data/seed.jsonl",
    "--limit", "88", "--report", REPORT,
)
with open(REPORT, encoding="utf-8") as report:
    print(report.read())

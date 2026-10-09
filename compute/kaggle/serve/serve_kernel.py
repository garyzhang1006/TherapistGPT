# Kaggle GPU kernel: serves the trained TherapistGPT model to the web app for a few hours. It runs compute/serve.py
# on one T4 with the merged model from therapistgpt-train-v3 (attached as a kernel source) and opens a Cloudflare
# quick tunnel to it. The tunnel's random https URL and the access key are printed to this kernel's log every
# 10 minutes; paste both into the app's Settings. The kernel stops after HOURS, which also ends the tunnel.
import glob
import json
import os
import re
import secrets
import subprocess
import sys
import threading
import time
import urllib.request

REPO = "/tmp/TherapistGPT"
# A new key each session, shown only in this private kernel's log. To keep one key across sessions, put a fixed
# string here before pushing, and never commit it.
API_KEY = secrets.token_hex(16)
HOURS = 10
ORIGIN = "https://garyzhang1006.github.io"
CLOUDFLARED = "https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-linux-amd64"
LOCAL = "http://127.0.0.1:8000"


def run(*args):
    print("+", " ".join(args), flush=True)
    subprocess.run(list(args), check=True)


def get_json(url, timeout=10, headers=None):
    with urllib.request.urlopen(urllib.request.Request(url, headers=headers or {}), timeout=timeout) as response:
        return json.load(response)


run("git", "clone", "--depth", "1", "--branch", "main", "https://github.com/garyzhang1006/TherapistGPT.git", REPO)
run(sys.executable, "-m", "pip", "install", "-q", "-r", f"{REPO}/compute/requirements.txt")
# Kaggle ships torchao 0.10.0, and peft 0.21.1 raises ImportError on any torchao older than 0.16.
run(sys.executable, "-m", "pip", "uninstall", "-y", "-q", "torchao")

configs = sorted(glob.glob("/kaggle/input/**/merged/config.json", recursive=True))
print("merged models:", configs, flush=True)
if not configs:
    raise SystemExit("no merged model under /kaggle/input; attach the output of therapistgpt-train-v3")
model_dir = os.path.dirname(configs[0])

run("curl", "-sSL", "-o", "/tmp/cloudflared", CLOUDFLARED)
os.chmod("/tmp/cloudflared", 0o755)

env = {**os.environ, "CUDA_VISIBLE_DEVICES": "0", "MODEL_ID": model_dir, "API_KEY": API_KEY, "ALLOWED_ORIGINS": ORIGIN}
server = subprocess.Popen(
    [sys.executable, "-m", "uvicorn", "serve:app", "--host", "127.0.0.1", "--port", "8000"], cwd=f"{REPO}/compute", env=env
)
deadline = time.time() + 15 * 60
while True:
    if server.poll() is not None:
        raise SystemExit(f"serve.py exited with code {server.returncode} while loading the model")
    try:
        if get_json(f"{LOCAL}/health").get("ok"):
            break
    except OSError:
        pass
    if time.time() > deadline:
        raise SystemExit("serve.py did not report ok on /health within 15 minutes")
    time.sleep(5)
print("model loaded", flush=True)

# http2 over TCP 443: QUIC needs outbound UDP, which a Kaggle session may not have.
tunnel = subprocess.Popen(
    ["/tmp/cloudflared", "tunnel", "--no-autoupdate", "--protocol", "http2", "--url", LOCAL],
    stderr=subprocess.PIPE, text=True,
)
url = None
for line in tunnel.stderr:
    print("cloudflared:", line.rstrip(), flush=True)
    found = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", line)
    if found:
        url = found.group(0)
        break
if not url:
    raise SystemExit(f"cloudflared exited with code {tunnel.wait()} before printing a tunnel URL")
# Keep reading so a full stderr pipe never blocks cloudflared.
threading.Thread(target=lambda: [None for _ in tunnel.stderr], daemon=True).start()

# A new quick tunnel can take a few seconds before its hostname resolves.
for _ in range(30):
    try:
        if get_json(f"{url}/health", timeout=15).get("ok"):
            break
    except OSError:
        pass
    time.sleep(10)
else:
    raise SystemExit(f"{url}/health never answered through the tunnel")

started = time.time()
while time.time() - started < HOURS * 3600:
    if server.poll() is not None or tunnel.poll() is not None:
        raise SystemExit(f"stopped early: serve.py code {server.poll()}, cloudflared code {tunnel.poll()}")
    left = (HOURS * 3600 - (time.time() - started)) / 3600
    print(f"\n===== READY  endpoint: {url}  access key: {API_KEY}  ({left:.1f} h left) =====\n", flush=True)
    time.sleep(600)
tunnel.terminate()
server.terminate()
print("time is up, tunnel closed", flush=True)

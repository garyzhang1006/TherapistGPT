# Hugging Face Docker Space for the TherapistGPT API.
# Build context is the compute/ folder: run `hf upload <user>/<space> . --repo-type space` or copy compute/ into the Space repo
# and move this Dockerfile to its root (see compute/README.md, "Deploy the API").
FROM python:3.12-slim

RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user PATH=/home/user/.local/bin:$PATH
WORKDIR /home/user/app

# CPU wheels keep the image small. On GPU Space hardware, set the build argument
# TORCH_INDEX=https://download.pytorch.org/whl/cu128 so requests finish well inside the app's 60s timeout.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir --user torch --index-url ${TORCH_INDEX}
RUN pip install --no-cache-dir --user transformers==5.17.0 peft==0.21.1 pyyaml fastapi==0.142.1 uvicorn==0.54.0

COPY --chown=user therapistgpt ./therapistgpt
COPY --chown=user serve.py config.yaml ./

# Spaces route traffic to port 7860.
EXPOSE 7860
CMD ["uvicorn", "serve:app", "--host", "0.0.0.0", "--port", "7860"]

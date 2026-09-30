"""HTTP API for the trained model, so the web app can use it instead of its built-in organizer.

Deploy on a GPU host (Hugging Face Space, a cloud VM, or Kaggle behind a tunnel for testing).

Environment:
    MODEL_ID         merged model (Hub id or path), or the base model when ADAPTER_ID is set
    ADAPTER_ID       optional LoRA adapter to apply on top of MODEL_ID
    ALLOWED_ORIGINS  comma-separated origins allowed to call the API (your GitHub Pages URL)
    API_KEY          optional shared secret; when set, requests need an X-API-Key header with it.
                     CORS only limits browsers, so set this on any public host.

Usage:
    MODEL_ID=your-hf-username/therapistgpt-1.5b ALLOWED_ORIGINS=https://garyzhang1006.github.io \
        uvicorn serve:app --host 0.0.0.0 --port 7860

Privacy: brain dumps are never logged or stored. Only request counts and timings are printed.
"""

from __future__ import annotations

import asyncio
import hmac
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent))

from therapistgpt.inference import Organizer  # noqa: E402
from therapistgpt.schema import SchemaError  # noqa: E402

# Training dumps run up to roughly 400 words. Much longer input is out of distribution and tends
# to get cut off mid-JSON, so the web app caps the text box at the same length.
MAX_CHARS = 3000
state: dict = {}


class OrganizeRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_CHARS)


@asynccontextmanager
async def lifespan(_: FastAPI):
    model_id = os.environ.get("MODEL_ID")
    if not model_id:
        raise RuntimeError("Set MODEL_ID to a merged TherapistGPT model or the base model plus ADAPTER_ID.")
    state["organizer"] = Organizer(model_id, adapter=os.environ.get("ADAPTER_ID"))
    # One GPU, one generation at a time; concurrent generate() calls would just fight for memory.
    state["lock"] = asyncio.Lock()
    yield
    state.clear()


app = FastAPI(title="TherapistGPT", lifespan=lifespan)
origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:8000").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware, allow_origins=origins, allow_methods=["POST", "GET"], allow_headers=["Content-Type", "X-API-Key"]
)


def check_key(given: str | None) -> None:
    expected = os.environ.get("API_KEY")
    # Compare bytes: compare_digest raises TypeError on non-ASCII str, which would surface as a 500.
    if expected and not hmac.compare_digest((given or "").encode(), expected.encode()):
        raise HTTPException(status_code=401, detail="missing or wrong X-API-Key")


@app.get("/health")
async def health() -> dict:
    return {"ok": "organizer" in state}


@app.post("/organize")
async def organize(req: OrganizeRequest, x_api_key: str | None = Header(default=None)) -> dict:
    check_key(x_api_key)
    if not req.text.strip():
        raise HTTPException(status_code=422, detail="text is empty")
    # A generation can't be cancelled once started, and the browser gives up after 60s. Queueing
    # behind a running request would only pile up abandoned work, so answer "busy" right away and
    # let the client fall back to its on-device organizer.
    if state["lock"].locked():
        raise HTTPException(status_code=503, detail="model is busy with another request")
    start = time.time()
    async with state["lock"]:
        try:
            result = await asyncio.to_thread(state["organizer"].organize, req.text)
        except SchemaError as exc:
            # The client falls back to its on-device organizer when it sees this.
            raise HTTPException(status_code=502, detail=f"model output was unusable: {exc}") from exc
    print(f"organized {len(req.text)} chars in {time.time() - start:.1f}s")
    return result

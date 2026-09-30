"""Load a trained TherapistGPT model and organize one brain dump. Shared by evaluate.py and serve.py.

Heavy imports (torch, transformers, peft) happen inside Organizer so the rest of the package
stays importable on machines without them.
"""

from __future__ import annotations

from typing import Any

from .prompt import build_messages
from .safety import mentions_crisis
from .schema import SchemaError, extract_json, validate

CRISIS_SUMMARY = (
    "What you wrote sounds really heavy, and I'm glad you put it into words. "
    "You deserve real support with this right now."
)
CRISIS_STEP = "Call or text 988 (US and Canada) or your local crisis line now, or tell someone near you that you're not safe."
# Stands in when every thread point was a crisis sentence, since the schema needs at least one thread.
CRISIS_THREAD_TITLE = "Inside your head"
CRISIS_THREAD_POINT = "Something very heavy, and it deserves real support."


def apply_safety_floor(brain_dump: str, output: dict[str, Any]) -> dict[str, Any]:
    """Force the crisis response when the keyword detector fires, even if the model missed it."""
    # A crisis phrase must never come back as a to-do, even when the model flagged the crisis itself.
    to_dos = [t for t in output["to_dos"] if not mentions_crisis(f"{t['task']} {t['first_step']}")]
    # Thread points that mention a crisis go too: the crisis card already answers those words, and
    # printing someone's worst sentence back to them is unkind. Same rule as web/js/safety.js.
    threads = [{**t, "points": [p for p in t["points"] if not mentions_crisis(p)]} for t in output["threads"]]
    threads = [t for t in threads if t["points"]]
    if not threads and output["threads"]:
        threads = [{"title": CRISIS_THREAD_TITLE, "points": [CRISIS_THREAD_POINT]}]
    output = {**output, "threads": threads, "to_dos": to_dos}
    if mentions_crisis(brain_dump) and not output["needs_support"]:
        output = {
            **output,
            "needs_support": True,
            "summary": CRISIS_SUMMARY,
            "one_small_step": CRISIS_STEP,
            # Reframing someone's words is the wrong move during a crisis; match the web app.
            "kinder_view": [],
        }
    return output


class Organizer:
    def __init__(self, model_id: str, adapter: str | None = None, device: str | None = None):
        """model_id: a base model or a merged TherapistGPT model (Hub id or local path).
        adapter: optional LoRA adapter (Hub id or local path) applied on top of model_id."""
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        # Qwen2.5 can overflow in fp16, so use bf16 where the GPU has it and fp32 otherwise
        # (1.5B in fp32 is about 6 GB, which still fits a T4).
        # is_bf16_supported() also says yes on a T4 through slow emulation, so ask for sm_80+ directly.
        use_bf16 = self.device == "cuda" and torch.cuda.get_device_capability()[0] >= 8
        dtype = torch.bfloat16 if use_bf16 else torch.float32
        tokenizer_source = adapter or model_id
        self.tokenizer = AutoTokenizer.from_pretrained(tokenizer_source)
        model = AutoModelForCausalLM.from_pretrained(model_id, dtype=dtype)
        if adapter:
            from peft import PeftModel

            model = PeftModel.from_pretrained(model, adapter)
            model = model.merge_and_unload()
        # train(False) is inference mode (same as .eval()): disables dropout.
        self.model = model.to(self.device).train(False)

    def generate_raw(self, brain_dump: str, max_new_tokens: int = 1024) -> str:
        prompt = self.tokenizer.apply_chat_template(
            build_messages(brain_dump), tokenize=False, add_generation_prompt=True
        )
        inputs = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        with self.torch.no_grad():
            out = self.model.generate(
                **inputs,
                max_new_tokens=max_new_tokens,
                do_sample=False,  # greedy: the output is a structured document, not creative text
                # Qwen's generation_config sets repetition_penalty=1.1 and sampling knobs; the penalty
                # still applies under greedy decoding and punishes the quotes and keys JSON must repeat.
                repetition_penalty=1.0,
                temperature=None,
                top_p=None,
                top_k=None,
                pad_token_id=self.tokenizer.eos_token_id,
            )
        return self.tokenizer.decode(out[0][inputs["input_ids"].shape[1] :], skip_special_tokens=True)

    def organize(self, brain_dump: str) -> dict[str, Any]:
        """Return validated JSON, with the safety floor applied. Raises SchemaError on unusable output."""
        if not brain_dump.strip():
            raise SchemaError("brain dump is empty")
        raw = self.generate_raw(brain_dump)
        output = validate(extract_json(raw))
        return apply_safety_floor(brain_dump, output)

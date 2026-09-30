"""The output contract shared by the data pipeline, the trainer, the evaluator and the server.

Stdlib only on purpose: validate_data.py and the CI job import this without installing torch.
The web app (web/js/render.js) renders exactly these keys, so change both together.
"""

from __future__ import annotations

import json
from typing import Any

MAX_THREADS = 5
MAX_POINTS_PER_THREAD = 6
MAX_TODOS = 6
MAX_REFRAMES = 3
MAX_FEELINGS = 6

# Keys in the order the model is trained to emit them. A fixed order makes the JSON
# easier for a 1.5B model to learn and lets us stream-render sections top to bottom.
KEYS = (
    "summary",
    "feelings",
    "threads",
    "to_dos",
    "kinder_view",
    "one_small_step",
    "needs_support",
)

EXAMPLE_OUTPUT: dict[str, Any] = {
    "summary": "You're exhausted, behind on school, and being really hard on yourself about it.",
    "feelings": ["exhausted", "guilty", "overwhelmed"],
    "threads": [
        {"title": "School", "points": ["The essay is due Friday", "You haven't opened the reading"]},
        {"title": "Rest", "points": ["You slept about four hours", "Everything feels heavier when you're this tired"]},
    ],
    "to_dos": [{"task": "Start the essay", "first_step": "Open the doc and write the title"}],
    "kinder_view": [
        {
            "thought": "I'm so lazy",
            "reframe": "Running on four hours of sleep isn't laziness. It's a body that's out of fuel.",
        }
    ],
    "one_small_step": "Drink a glass of water, then open the essay doc. That's all for now.",
    "needs_support": False,
}


class SchemaError(ValueError):
    pass


def _require_str(obj: dict, key: str, path: str, allow_empty: bool = False) -> None:
    value = obj.get(key)
    if not isinstance(value, str):
        raise SchemaError(f"{path}.{key} must be a string, got {type(value).__name__}")
    if not allow_empty and not value.strip():
        raise SchemaError(f"{path}.{key} must not be empty")


def validate(output: Any) -> dict[str, Any]:
    """Raise SchemaError with a readable path if `output` breaks the contract; return it unchanged if valid."""
    if not isinstance(output, dict):
        raise SchemaError(f"output must be a JSON object, got {type(output).__name__}")

    missing = [k for k in KEYS if k not in output]
    extra = [k for k in output if k not in KEYS]
    if missing:
        raise SchemaError(f"missing keys: {missing}")
    if extra:
        raise SchemaError(f"unexpected keys: {extra}")

    _require_str(output, "summary", "$")
    _require_str(output, "one_small_step", "$")

    if not isinstance(output["needs_support"], bool):
        raise SchemaError("$.needs_support must be true or false")

    feelings = output["feelings"]
    if not isinstance(feelings, list) or not all(isinstance(f, str) and f.strip() for f in feelings):
        raise SchemaError("$.feelings must be a list of non-empty strings")
    if len(feelings) > MAX_FEELINGS:
        raise SchemaError(f"$.feelings has {len(feelings)} items, max is {MAX_FEELINGS}")

    threads = output["threads"]
    if not isinstance(threads, list) or not 1 <= len(threads) <= MAX_THREADS:
        raise SchemaError(f"$.threads must be a list of 1 to {MAX_THREADS} items")
    for i, thread in enumerate(threads):
        path = f"$.threads[{i}]"
        if not isinstance(thread, dict) or set(thread) != {"title", "points"}:
            raise SchemaError(f"{path} must have exactly the keys title and points")
        _require_str(thread, "title", path)
        points = thread["points"]
        if not isinstance(points, list) or not 1 <= len(points) <= MAX_POINTS_PER_THREAD:
            raise SchemaError(f"{path}.points must be a list of 1 to {MAX_POINTS_PER_THREAD} strings")
        if not all(isinstance(p, str) and p.strip() for p in points):
            raise SchemaError(f"{path}.points must contain only non-empty strings")

    todos = output["to_dos"]
    if not isinstance(todos, list) or len(todos) > MAX_TODOS:
        raise SchemaError(f"$.to_dos must be a list of at most {MAX_TODOS} items")
    for i, todo in enumerate(todos):
        path = f"$.to_dos[{i}]"
        if not isinstance(todo, dict) or set(todo) != {"task", "first_step"}:
            raise SchemaError(f"{path} must have exactly the keys task and first_step")
        _require_str(todo, "task", path)
        _require_str(todo, "first_step", path)

    reframes = output["kinder_view"]
    if not isinstance(reframes, list) or len(reframes) > MAX_REFRAMES:
        raise SchemaError(f"$.kinder_view must be a list of at most {MAX_REFRAMES} items")
    for i, item in enumerate(reframes):
        path = f"$.kinder_view[{i}]"
        if not isinstance(item, dict) or set(item) != {"thought", "reframe"}:
            raise SchemaError(f"{path} must have exactly the keys thought and reframe")
        _require_str(item, "thought", path)
        _require_str(item, "reframe", path)

    return output


def to_canonical_json(output: dict[str, Any]) -> str:
    """Serialize with keys in training order. Compact separators keep sequences short."""
    ordered = {k: output[k] for k in KEYS}
    return json.dumps(ordered, ensure_ascii=False, separators=(",", ":"))


def extract_json(text: str) -> dict[str, Any]:
    """Pull the first balanced JSON object out of raw model text (models sometimes add stray prose)."""
    start = text.find("{")
    if start == -1:
        raise SchemaError("no JSON object found in model output")
    depth = 0
    in_string = False
    escaped = False
    for i in range(start, len(text)):
        ch = text[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(text[start : i + 1])
                except json.JSONDecodeError as exc:
                    raise SchemaError(f"model output is not valid JSON: {exc}") from exc
    raise SchemaError("model output has an unclosed JSON object (probably hit max_new_tokens)")

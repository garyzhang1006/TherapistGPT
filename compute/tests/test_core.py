"""Stdlib-only tests for the parts of compute/ that don't need a GPU. Run: python -m unittest discover -s tests"""

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from therapistgpt.inference import apply_safety_floor  # noqa: E402
from therapistgpt.prompt import SYSTEM_PROMPT, build_messages  # noqa: E402
from therapistgpt.safety import mentions_crisis  # noqa: E402
from therapistgpt.schema import EXAMPLE_OUTPUT, KEYS, SchemaError, extract_json, to_canonical_json, validate  # noqa: E402


class SchemaTests(unittest.TestCase):
    def test_example_is_valid(self):
        validate(copy.deepcopy(EXAMPLE_OUTPUT))

    def test_seed_rows_are_valid(self):
        for line in (HERE / "data" / "seed.jsonl").read_text(encoding="utf-8").splitlines():
            validate(json.loads(line)["output"])

    def test_rejects_missing_and_extra_keys(self):
        broken = copy.deepcopy(EXAMPLE_OUTPUT)
        del broken["summary"]
        with self.assertRaises(SchemaError):
            validate(broken)
        with self.assertRaises(SchemaError):
            validate({**EXAMPLE_OUTPUT, "diagnosis": "x"})

    def test_rejects_too_many_threads(self):
        too_many = {**EXAMPLE_OUTPUT, "threads": [{"title": "t", "points": ["p"]}] * 6}
        with self.assertRaises(SchemaError):
            validate(too_many)

    def test_canonical_json_keeps_training_key_order(self):
        shuffled = {k: EXAMPLE_OUTPUT[k] for k in reversed(KEYS)}
        self.assertEqual(list(json.loads(to_canonical_json(shuffled))), list(KEYS))

    def test_extract_json_ignores_prose_and_braces_in_strings(self):
        self.assertEqual(extract_json('Sure! {"a": "}{"} done'), {"a": "}{"})

    def test_extract_json_reports_truncation(self):
        with self.assertRaises(SchemaError):
            extract_json('{"summary": "cut off')


class SafetyTests(unittest.TestCase):
    def test_flags_crisis_language(self):
        for text in ["I don’t want to be here", "kms", "i keep cutting myself", "no point in living"]:
            self.assertTrue(mentions_crisis(text), text)

    def test_ignores_figures_of_speech(self):
        for text in ["this exam will kill me", "I want to end things with him", "my phone died"]:
            self.assertFalse(mentions_crisis(text), text)

    def test_floor_overrides_a_missed_crisis(self):
        out = apply_safety_floor("i want to die", {**EXAMPLE_OUTPUT, "needs_support": False})
        self.assertTrue(out["needs_support"])
        self.assertIn("988", out["one_small_step"])


class PromptTests(unittest.TestCase):
    def test_inference_messages_have_no_assistant_turn(self):
        roles = [m["role"] for m in build_messages("hello")]
        self.assertEqual(roles, ["system", "user"])

    def test_training_messages_end_with_json(self):
        messages = build_messages("hello", EXAMPLE_OUTPUT)
        self.assertEqual(json.loads(messages[-1]["content"])["summary"], EXAMPLE_OUTPUT["summary"])

    def test_prompt_names_every_key(self):
        for key in KEYS:
            self.assertIn(f'"{key}"', SYSTEM_PROMPT)


if __name__ == "__main__":
    unittest.main()

"""Stdlib-only tests for the parts of compute/ that don't need a GPU. Run: python -m unittest discover -s tests"""

import copy
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from therapistgpt import handwritten  # noqa: E402
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
        for text in ["I don’t want to be here", "kms", "i keep cutting myself", "no point in living",
                     "I can‘t go on", "i can`t do this anymore", "I canʼt go on", "I can＇t go on"]:
            self.assertTrue(mentions_crisis(text), text)

    def test_shared_cases_match_the_web_detector(self):
        cases = json.loads((HERE / "tests" / "crisis_cases.json").read_text(encoding="utf-8"))
        for text in cases["should_flag"]:
            self.assertTrue(mentions_crisis(text), text)
        for text in cases["should_not_flag"]:
            self.assertFalse(mentions_crisis(text), text)

    def test_ignores_figures_of_speech(self):
        for text in ["this exam will kill me", "I want to end things with him", "my phone died"]:
            self.assertFalse(mentions_crisis(text), text)

    def test_one_warning_sign_alone_stays_calm(self):
        for text in ["gave my old notes to sam", "wrote letters to colleges", "i feel calm finally after yoga",
                     "whats the point of this meeting", "i dont need to book anything, my sister planned the trip"]:
            self.assertFalse(mentions_crisis(text), text)

    def test_two_different_warning_signs_flag(self):
        for text in ["gave my guitar to marcus and wrote letters for my mom", "feels calm finally. wont need it anymore",
                     "whats the point of any of it. said my goodbyes to everyone"]:
            self.assertTrue(mentions_crisis(text), text)

    def test_the_same_warning_sign_twice_counts_once(self):
        self.assertFalse(mentions_crisis("gave my guitar to marcus and gave my books to jen"))

    def test_each_warning_sign_flags_with_a_second_one(self):
        # Pairs each sign with the giving-away sign, so a sign that never matches fails here.
        give = "gave my guitar to marcus"
        for sign in ["wrote letters for mom", "feels calm finally", "dont really need to renew the lease",
                     "said goodbye to everyone", "whats the point of any of it"]:
            self.assertFalse(mentions_crisis(sign), sign)
            self.assertTrue(mentions_crisis(f"{give}. {sign}"), sign)

    def test_floor_overrides_a_missed_crisis(self):
        out = apply_safety_floor("i want to die", {**EXAMPLE_OUTPUT, "needs_support": False})
        self.assertTrue(out["needs_support"])
        self.assertIn("988", out["one_small_step"])

    def test_floor_drops_crisis_todos_even_when_model_flagged_it(self):
        todos = [{"task": "End it all", "first_step": "Start small"}, {"task": "Do laundry", "first_step": "Gather clothes"}]
        out = apply_safety_floor("i have to end it all", {**EXAMPLE_OUTPUT, "needs_support": True, "to_dos": todos})
        self.assertEqual([t["task"] for t in out["to_dos"]], ["Do laundry"])

    def test_floor_drops_crisis_points_and_emptied_threads(self):
        threads = [
            {"title": "School", "points": ["Chem quiz tomorrow", "I don't want to be here anymore"]},
            {"title": "Inside your head", "points": ["i want to die"]},
        ]
        out = apply_safety_floor("chem quiz tomorrow. i want to die", {**EXAMPLE_OUTPUT, "threads": threads})
        self.assertEqual(out["threads"], [{"title": "School", "points": ["Chem quiz tomorrow"]}])
        validate(out)

    def test_floor_keeps_one_gentle_thread_when_every_point_is_a_crisis(self):
        threads = [{"title": "Inside your head", "points": ["i want to die", "I can't go on"]}]
        out = apply_safety_floor("i want to die. i can't go on", {**EXAMPLE_OUTPUT, "threads": threads})
        self.assertEqual(len(out["threads"]), 1)
        self.assertFalse(any(mentions_crisis(p) for t in out["threads"] for p in t["points"]))
        validate(out)


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


class HandwrittenTests(unittest.TestCase):
    def test_loads_every_fixture_with_both_kinds_up_front(self):
        rows = handwritten.load()
        crisis = [r for r in rows if r["needs_support"]]
        self.assertGreaterEqual(len(crisis), 44)
        self.assertGreaterEqual(len(rows) - len(crisis), 97)
        self.assertEqual([r["needs_support"] for r in rows[:4]], [True, False, True, False])
        self.assertEqual(len({(r["set"], r["id"]) for r in rows}), len(rows))

    def test_python_phrase_list_matches_the_web_eval_on_every_dump(self):
        # The web eval reports full recall and no false alarms on these with safety.js, and safety.py
        # must say the same, or the server's safety floor differs from the app's.
        rows = handwritten.load()
        scores = handwritten.crisis_scores(rows, [False] * len(rows))
        phrase = scores["phrase_list_tuned_on_these"]
        self.assertEqual(phrase["recall"], 1.0, phrase["caught"])
        self.assertEqual(phrase["false_alarm_rate"], 0.0, phrase["false_alarms"])
        self.assertEqual(scores["model"]["recall"], 0.0)
        self.assertEqual(scores["model_plus_phrase_list"]["recall"], 1.0)

    def test_scores_count_misses_and_false_alarms(self):
        rows = [
            {"id": "a", "set": "s", "input": "i want to kill myself", "needs_support": True},
            {"id": "b", "set": "s", "input": "everything feels heavy and far away", "needs_support": True},
            {"id": "c", "set": "s", "input": "need to pay rent", "needs_support": False},
        ]
        scores = handwritten.crisis_scores(rows, [False, True, True])
        self.assertEqual(scores["model"]["caught"], "1/2")
        self.assertEqual(scores["model"]["false_alarms"], "1/1")
        self.assertEqual(scores["model_missed"], ["s/a"])
        self.assertEqual(scores["model_false_alarms"], ["s/c"])
        self.assertEqual(scores["model_plus_phrase_list"]["caught"], "2/2")

    def test_wilson_interval(self):
        self.assertIsNone(handwritten.wilson(0, 0))
        low, high = handwritten.wilson(44, 44)
        self.assertEqual(high, 1.0)
        self.assertTrue(0.91 < low < 0.93, low)
        low, high = handwritten.wilson(8, 8)
        self.assertLess(low, 0.7)


if __name__ == "__main__":
    unittest.main()

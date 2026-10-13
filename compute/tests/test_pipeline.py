"""Stdlib-only tests for the data and output plumbing in compute/. Run: python -m unittest discover -s tests"""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

import split_data  # noqa: E402
from therapistgpt.schema import EXAMPLE_OUTPUT, SchemaError, extract_json  # noqa: E402


class ExtractJsonTests(unittest.TestCase):
    def test_skips_a_brace_in_leading_prose(self):
        self.assertEqual(extract_json('Here it is {as asked}: {"summary": "s"}'), {"summary": "s"})
        self.assertEqual(extract_json('one { open brace {"summary": "s"}'), {"summary": "s"})

    def test_truncated_reply_does_not_pass_through_a_nested_object(self):
        cut = '{"summary": "s", "threads": [{"title": "t", "points": ["p"]}, {"title": "u"'
        with self.assertRaisesRegex(SchemaError, "unclosed"):
            extract_json(cut)


class SplitDataTests(unittest.TestCase):
    def test_load_keeps_rows_with_unicode_line_separators(self):
        rows = [{"input": f"first part{sep}second part", "output": copy.deepcopy(EXAMPLE_OUTPUT)} for sep in " \x85"]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "rows.jsonl"
            path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
            self.assertEqual(split_data.load(path), rows)

    def split(self, tmp: Path, inputs: list[Path], *extra: str) -> dict[str, list[dict]]:
        argv = ["split_data.py", "--inputs", *map(str, inputs), "--out-dir", str(tmp), *extra]
        with mock.patch.object(sys, "argv", argv):
            self.assertEqual(split_data.main(), 0)
        return {name: split_data.load(tmp / f"{name}.jsonl") for name in ("train", "val", "test")}

    def test_seed_rows_stay_anchors_when_listed_last(self):
        seed_path = HERE / "data" / "seed.jsonl"
        seeds = [json.loads(line) for line in seed_path.read_text(encoding="utf-8").split("\n") if line.strip()]
        calm = next(r for r in seeds if not r["output"]["needs_support"])
        copied = {"input": calm["input"], "output": {**calm["output"], "summary": "A synthetic copy."}}
        with tempfile.TemporaryDirectory() as tmp:
            synthetic = Path(tmp) / "synthetic.jsonl"
            synthetic.write_text(json.dumps(copied, ensure_ascii=False) + "\n", encoding="utf-8")
            splits = self.split(Path(tmp), [synthetic, seed_path])
        for row in seeds:
            self.assertIn(row, splits["train"])
        self.assertNotIn(copied, splits["train"] + splits["val"] + splits["test"])

    def test_every_split_gets_a_crisis_row_from_a_small_group(self):
        crisis = {**copy.deepcopy(EXAMPLE_OUTPUT), "needs_support": True}
        rows = [{"input": f"crisis dump {i}", "output": crisis} for i in range(3)]
        rows += [{"input": f"calm dump {i}", "output": copy.deepcopy(EXAMPLE_OUTPUT)} for i in range(20)]
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic.jsonl"
            path.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows), encoding="utf-8")
            splits = self.split(Path(tmp), [path])
        for name, split in splits.items():
            self.assertEqual(sum(r["output"]["needs_support"] for r in split), 1, name)


if __name__ == "__main__":
    unittest.main()

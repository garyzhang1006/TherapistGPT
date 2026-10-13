"""Stdlib-only tests for the data and output plumbing in compute/. Run: python -m unittest discover -s tests"""

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

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


if __name__ == "__main__":
    unittest.main()

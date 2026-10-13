"""Stdlib-only tests for the data and output plumbing in compute/. Run: python -m unittest discover -s tests"""

import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))

from therapistgpt.schema import SchemaError, extract_json  # noqa: E402


class ExtractJsonTests(unittest.TestCase):
    def test_skips_a_brace_in_leading_prose(self):
        self.assertEqual(extract_json('Here it is {as asked}: {"summary": "s"}'), {"summary": "s"})
        self.assertEqual(extract_json('one { open brace {"summary": "s"}'), {"summary": "s"})

    def test_truncated_reply_does_not_pass_through_a_nested_object(self):
        cut = '{"summary": "s", "threads": [{"title": "t", "points": ["p"]}, {"title": "u"'
        with self.assertRaisesRegex(SchemaError, "unclosed"):
            extract_json(cut)


if __name__ == "__main__":
    unittest.main()

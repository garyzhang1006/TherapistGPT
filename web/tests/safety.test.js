import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRISIS_PATTERNS, mentionsCrisis, applySafetyFloor } from "../js/safety.js";

test("JS crisis patterns match the Python list exactly", () => {
  const py = readFileSync(new URL("../../compute/therapistgpt/safety.py", import.meta.url), "utf8");
  const pyPatterns = [...py.matchAll(/^\s+r"(.*)",$/gm)].map((m) => m[1]);
  assert.deepEqual(CRISIS_PATTERNS.map((p) => p.source), pyPatterns);
});

test("catches direct and indirect crisis language, including curly apostrophes", () => {
  for (const text of ["I don’t want to be here", "i keep cutting myself", "thinking about suicide", "they'd be better off without me", "honestly kms", "i cant go on like this", "i just want to disappear forever", "I can‘t go on", "i can`t do this anymore", "I canʼt go on", "I can＇t go on"]) {
    assert.equal(mentionsCrisis(text), true, text);
  }
});

const CASES = JSON.parse(readFileSync(new URL("../../compute/tests/crisis_cases.json", import.meta.url), "utf8"));

test("flags every shared crisis case, including indirect phrasings", () => {
  for (const text of CASES.should_flag) assert.equal(mentionsCrisis(text), true, text);
});

test("leaves every shared figure-of-speech case alone", () => {
  for (const text of CASES.should_not_flag) assert.equal(mentionsCrisis(text), false, text);
});

test("ignores common figures of speech", () => {
  for (const text of ["this exam will kill me lol", "I'm dying to see that movie", "my phone died", "I want to end things with my boyfriend"]) {
    assert.equal(mentionsCrisis(text), false, text);
  }
});

test("safety floor overrides a model that missed the crisis", () => {
  const modelOut = { summary: "x", feelings: [], threads: [], to_dos: [], kinder_view: [], one_small_step: "y", needs_support: false };
  const out = applySafetyFloor("i want to die", modelOut);
  assert.equal(out.needs_support, true);
  assert.match(out.one_small_step, /988/);
});

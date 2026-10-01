import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CRISIS_PATTERNS, WARNING_SIGNS, mentionsCrisis, applySafetyFloor } from "../js/safety.js";

const PY = readFileSync(new URL("../../compute/therapistgpt/safety.py", import.meta.url), "utf8");
const PATTERN_LINE = /^\s+r"(.*)",$/gm;

// Reads one named list from safety.py, so a warning sign can never pass as a crisis pattern. A
// pattern may contain "]", so the list ends at the first "]" alone on its line.
function pyList(name) {
  const start = PY.indexOf(`\n${name} = [\n`);
  assert.ok(start >= 0, `${name} = [ not found in safety.py`);
  const end = PY.indexOf("\n]\n", start);
  assert.ok(end > start, `${name} has no closing ] in safety.py`);
  return [...PY.slice(start, end).matchAll(PATTERN_LINE)].map((m) => m[1]);
}

test("JS crisis patterns match the Python list exactly", () => {
  assert.deepEqual(CRISIS_PATTERNS.map((p) => p.source), pyList("CRISIS_PATTERNS"));
});

test("JS warning signs match the Python list exactly", () => {
  assert.deepEqual(WARNING_SIGNS.map((p) => p.source), pyList("WARNING_SIGNS"));
});

test("every pattern line in safety.py belongs to one of the two lists", () => {
  assert.equal([...PY.matchAll(PATTERN_LINE)].length, CRISIS_PATTERNS.length + WARNING_SIGNS.length);
});

test("one warning sign alone stays calm, and two different ones flag", () => {
  for (const text of ["gave my old notes to sam", "wrote letters to colleges", "i feel calm finally after yoga", "whats the point of this meeting", "gave my guitar to marcus and gave my books to jen"]) {
    assert.equal(mentionsCrisis(text), false, text);
  }
  for (const text of ["gave my guitar to marcus and wrote letters for my mom", "feels calm finally. wont need it anymore"]) {
    assert.equal(mentionsCrisis(text), true, text);
  }
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

test("safety floor drops crisis to-dos even when the model flagged the crisis itself", () => {
  const modelOut = {
    summary: "x", feelings: [], threads: [], kinder_view: [], one_small_step: "y", needs_support: true,
    to_dos: [{ task: "End it all", first_step: "Start small" }, { task: "Do laundry", first_step: "Gather the clothes" }],
  };
  const out = applySafetyFloor("i have to end it all and do laundry", modelOut);
  assert.deepEqual(out.to_dos.map((t) => t.task), ["Do laundry"]);
});

test("safety floor drops crisis points and any thread they leave empty", () => {
  const modelOut = {
    summary: "x", feelings: [], to_dos: [], kinder_view: [], one_small_step: "y", needs_support: true,
    threads: [
      { title: "School", points: ["Chem quiz tomorrow", "I don’t want to be here anymore"] },
      { title: "Inside your head", points: ["i want to die"] },
    ],
  };
  const out = applySafetyFloor("chem quiz tomorrow. i want to die", modelOut);
  assert.deepEqual(out.threads, [{ title: "School", points: ["Chem quiz tomorrow"] }]);
});

test("safety floor keeps one gentle thread when every point was a crisis", () => {
  const modelOut = {
    summary: "x", feelings: [], to_dos: [], kinder_view: [], one_small_step: "y", needs_support: false,
    threads: [{ title: "Inside your head", points: ["i want to die", "I can't go on"] }],
  };
  const out = applySafetyFloor("i want to die. i can't go on", modelOut);
  assert.equal(out.threads.length, 1);
  assert.ok(out.threads[0].title.trim() && out.threads[0].points.length === 1 && out.threads[0].points[0].trim());
  assert.ok(out.threads.every((t) => t.points.every((p) => !mentionsCrisis(p))));
  assert.equal(out.needs_support, true);
});

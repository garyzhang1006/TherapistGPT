import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { organize, splitClauses } from "../js/organizer.js";

const seeds = readFileSync(new URL("../../compute/data/seed.jsonl", import.meta.url), "utf8")
  .trim()
  .split("\n")
  .map((line) => JSON.parse(line));

const KEYS = ["summary", "feelings", "threads", "to_dos", "kinder_view", "one_small_step", "needs_support"];

// Same limits as compute/therapistgpt/schema.py, so the UI can trust either engine.
function assertSchema(out) {
  assert.deepEqual(Object.keys(out), KEYS);
  assert.ok(out.summary.trim());
  assert.ok(out.one_small_step.trim());
  assert.equal(typeof out.needs_support, "boolean");
  assert.ok(out.feelings.length <= 6);
  assert.ok(out.threads.length >= 1 && out.threads.length <= 5);
  for (const t of out.threads) {
    assert.ok(t.title.trim());
    assert.ok(t.points.length >= 1 && t.points.length <= 6);
    t.points.forEach((p) => assert.ok(p.trim()));
  }
  assert.ok(out.to_dos.length <= 6);
  out.to_dos.forEach((t) => assert.ok(t.task.trim() && t.first_step.trim()));
  assert.ok(out.kinder_view.length <= 3);
  out.kinder_view.forEach((k) => assert.ok(k.thought.trim() && k.reframe.trim()));
}

test("every seed brain dump produces schema-valid output", () => {
  for (const row of seeds) assertSchema(organize(row.input));
});

test("crisis flag matches the hand labels on every seed", () => {
  for (const row of seeds) assert.equal(organize(row.input).needs_support, row.output.needs_support, row.input.slice(0, 60));
});

test("crisis output drops reframes and points to a crisis line", () => {
  const out = organize("honestly i want to die and everyone would be better off without me");
  assert.equal(out.needs_support, true);
  assert.deepEqual(out.kinder_view, []);
  assert.match(out.one_small_step, /988/);
});

test("run-on text without punctuation still splits into several points", () => {
  const clauses = splitClauses(
    "i cant sleep and i have a test tomorrow and my mom keeps calling me and i feel like i am falling behind in everything"
  );
  assert.ok(clauses.length >= 3, clauses.join(" | "));
});

test("comma lists of chores become separate to-dos", () => {
  const out = organize("I still need to do laundry, groceries, the school form, the dentist call.");
  assert.ok(out.to_dos.length >= 3, JSON.stringify(out.to_dos));
});

test("memories are not turned into to-dos", () => {
  const out = organize("My mom called and I didn't pick up. I didn't go to class.");
  assert.equal(out.to_dos.length, 0, JSON.stringify(out.to_dos));
});

test("harsh self-talk gets a kinder view", () => {
  const out = organize("I'm so lazy. I can't even do the dishes.");
  assert.equal(out.kinder_view.length, 1);
  assert.match(out.kinder_view[0].reframe, /not laziness/);
});

test("very short and empty-ish input still returns something gentle", () => {
  assertSchema(organize("tired"));
  assertSchema(organize("ugh"));
  assertSchema(organize("..."));
  assertSchema(organize("so,"));
});

test("long input respects every list limit", () => {
  const long = Array.from({ length: 60 }, (_, i) => `I need to finish task number ${i} for work and school and home.`).join(" ");
  assertSchema(organize(long));
});

test("crisis words never become to-dos", () => {
  for (const text of ["I should just kill myself", "i have to end it all", "I need to stop existing", "I need to disappear"]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
});

test("list lines become separate to-dos without their bullets", () => {
  assert.deepEqual(organize("- call mom\n- pay rent\n- groceries").to_dos.map((t) => t.task), ["Call mom", "Pay rent", "Groceries"]);
  assert.deepEqual(
    organize("things to do: email professor, call landlord, book dentist").to_dos.map((t) => t.task),
    ["Email professor", "Call landlord", "Book dentist"]
  );
  assert.deepEqual(organize("i gotta do the dishes, the laundry, and the trash").to_dos.map((t) => t.task), ["Do the dishes", "Do the laundry", "Do the trash"]);
});

test("memories and self-judgments are not to-dos", () => {
  for (const text of ["I finally did laundry yesterday", "I should be happier", "I must be broken", "Due to the rain I stayed in", "Text from my sister made me cry"]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
});

test("a to-do keeps the task and leaves the feeling about it behind", () => {
  const { to_dos } = organize("I need to finish my thesis chapter and I haven't opened it in a week");
  assert.equal(to_dos[0].task, "Finish my thesis chapter");
});

test("blank input still gets one gentle thread", () => {
  assert.equal(organize("   \n\t ").threads.length, 1);
});

test("harsh self-talk gets a kinder view and its own thread, and plain words don't", () => {
  const out = organize("i feel like such a failure, everyone else has it together. my mom called");
  assert.equal(out.kinder_view.length, 1);
  assert.equal(out.threads.find((t) => t.points.some((p) => /failure/.test(p))).title, "Inside your head");
  assert.equal(organize("I always love seeing my dog").kinder_view.length, 0);
});

test("feelings come from feeling words, not colors or objects", () => {
  assert.deepEqual(organize("wore my grey hoodie, got a flat tire, told him to leave me alone").feelings, []);
  assert.ok(organize("i miss sam so much").feelings.includes("sad"));
});

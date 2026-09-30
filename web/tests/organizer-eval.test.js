import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { organize } from "../js/organizer.js";

// Scores the on-device organizer against brain dumps labeled by a human reader. Missing a crisis
// fails CI outright. Everything else is reported so the CI log alone shows what to fix next.
const load = (url) => JSON.parse(readFileSync(url, "utf8")).cases;
const CASES = load(new URL("./fixtures/brain-dumps.json", import.meta.url));
// Written blind by someone who never saw the organizer, so it shows whether the rules generalize.
// Only its crisis recall is held to a bar; the rest is reported.
const HELDOUT_URL = new URL("./fixtures/brain-dumps-heldout.json", import.meta.url);
const HELDOUT = existsSync(HELDOUT_URL) ? load(HELDOUT_URL) : null;

// Each one sits at the score CI last reported, so any regression fails. Raise them as the organizer improves.
const THRESHOLDS = {
  todoRecall: 20 / 30,
  todoPrecision: 19 / 22,
  threadRecall: 34 / 44,
  feelingRecall: 13 / 27,
  maxFalseAlarms: 0,
  maxNotTodoViolations: 1,
};

const has = (haystack, keyword) => haystack.toLowerCase().includes(keyword.toLowerCase());

function score(c) {
  const out = organize(c.text);
  const tasks = out.to_dos.map((t) => t.task);
  const titles = out.threads.map((t) => t.title);
  return {
    id: c.id,
    case: c,
    flagged: out.needs_support,
    expectedFlag: c.needs_support,
    tasks,
    titles,
    feelings: out.feelings,
    todoMisses: c.todos.filter((k) => !tasks.some((t) => has(t, k))),
    // A to-do counts as precise when it names one of the things the reader expected.
    extraTasks: tasks.filter((t) => !c.todos.some((k) => has(t, k))),
    violations: c.not_todos.filter((k) => tasks.some((t) => has(t, k))),
    threadMisses: c.threads.filter((x) => !titles.includes(x)),
    feelingMisses: c.feelings.filter((f) => !out.feelings.includes(f)),
  };
}

function ratio(hit, total) {
  return { hit, total, value: total ? hit / total : 1 };
}

function fmt({ hit, total, value }) {
  return `${hit}/${total} (${Math.round(value * 100)}%)`;
}

function evaluate(cases) {
  const results = cases.map(score);
  const sum = (f) => results.reduce((n, r) => n + f(r), 0);
  const expectedTodos = sum((r) => r.case.todos.length);
  const outputTodos = sum((r) => r.tasks.length);
  const crisisCases = results.filter((r) => r.expectedFlag);
  const calmCases = results.filter((r) => !r.expectedFlag);
  const metrics = {
    crisisRecall: ratio(crisisCases.filter((r) => r.flagged).length, crisisCases.length),
    falseAlarms: calmCases.filter((r) => r.flagged).length,
    todoRecall: ratio(expectedTodos - sum((r) => r.todoMisses.length), expectedTodos),
    todoPrecision: ratio(outputTodos - sum((r) => r.extraTasks.length), outputTodos),
    notTodoViolations: sum((r) => r.violations.length),
    threadRecall: ratio(sum((r) => r.case.threads.length) - sum((r) => r.threadMisses.length), sum((r) => r.case.threads.length)),
    feelingRecall: ratio(sum((r) => r.case.feelings.length) - sum((r) => r.feelingMisses.length), sum((r) => r.case.feelings.length)),
  };
  return { results, crisisCases, calmCases, metrics };
}

// Prints the totals line, then one line per case with anything missed or extra.
function report(t, label, { results, calmCases, metrics }) {
  t.diagnostic(
    [
      `${label}crisis recall ${fmt(metrics.crisisRecall)}`,
      `false alarms ${metrics.falseAlarms}/${calmCases.length}`,
      `to-do recall ${fmt(metrics.todoRecall)}`,
      `to-do precision ${fmt(metrics.todoPrecision)}`,
      `not_todo violations ${metrics.notTodoViolations}`,
      `thread recall ${fmt(metrics.threadRecall)}`,
      `feeling recall ${fmt(metrics.feelingRecall)}`,
    ].join(" | ")
  );
  for (const r of results) {
    const notes = [];
    if (r.flagged !== r.expectedFlag) notes.push(r.flagged ? "false alarm" : "CRISIS MISSED");
    if (r.todoMisses.length) notes.push(`todo miss [${r.todoMisses.join(", ")}]`);
    if (r.extraTasks.length) notes.push(`extra to-dos [${r.extraTasks.join("; ")}]`);
    if (r.violations.length) notes.push(`not_todo hit [${r.violations.join(", ")}]`);
    if (r.threadMisses.length) notes.push(`thread miss [${r.threadMisses.join(", ")}] got [${r.titles.join(", ")}]`);
    if (r.feelingMisses.length) notes.push(`feeling miss [${r.feelingMisses.join(", ")}] got [${r.feelings.join(", ")}]`);
    if (notes.length) t.diagnostic(`${label}${r.id}: ${notes.join(" | ")}`);
  }
}

const fixed = evaluate(CASES);

test("the brain-dump fixture is well formed", () => {
  assert.ok(CASES.length >= 45, `only ${CASES.length} cases`);
  assert.ok(CASES.filter((c) => c.needs_support).length >= 8, "fewer than 8 crisis cases");
  assert.equal(new Set(CASES.map((c) => c.id)).size, CASES.length, "duplicate case ids");
  for (const c of CASES) {
    assert.equal(typeof c.text, "string", c.id);
    assert.equal(typeof c.needs_support, "boolean", c.id);
    for (const key of ["todos", "not_todos", "threads", "feelings"]) assert.ok(Array.isArray(c[key]), `${c.id}.${key}`);
  }
});

test("every crisis brain dump gets the helpline card", () => {
  const missed = fixed.crisisCases.filter((r) => !r.flagged).map((r) => r.id);
  assert.deepEqual(missed, [], `crisis missed: ${missed.join(", ")}`);
});

test("organizer scores on the fixed brain-dump set", (t) => {
  const { metrics } = fixed;
  report(t, "", fixed);
  assert.ok(metrics.todoRecall.value >= THRESHOLDS.todoRecall, "to-do recall fell below its threshold");
  assert.ok(metrics.todoPrecision.value >= THRESHOLDS.todoPrecision, "to-do precision fell below its threshold");
  assert.ok(metrics.threadRecall.value >= THRESHOLDS.threadRecall, "thread recall fell below its threshold");
  assert.ok(metrics.feelingRecall.value >= THRESHOLDS.feelingRecall, "feeling recall fell below its threshold");
  assert.ok(metrics.falseAlarms <= THRESHOLDS.maxFalseAlarms, "too many false crisis alarms");
  assert.ok(metrics.notTodoViolations <= THRESHOLDS.maxNotTodoViolations, "too many not_todos became to-dos");
});

test("organizer scores on the held-out brain-dump set", { skip: HELDOUT ? false : "no held-out fixture yet" }, (t) => {
  const heldout = evaluate(HELDOUT);
  report(t, "held-out ", heldout);
  const missed = heldout.crisisCases.filter((r) => !r.flagged).map((r) => r.id);
  assert.deepEqual(missed, [], `held-out crisis missed: ${missed.join(", ")}`);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { organize } from "../js/organizer.js";

// Scores the on-device organizer against brain dumps labeled by a human reader. Missing a crisis
// fails CI outright on every fixture. Everything else is reported so the CI log alone shows what to fix next.
const FIXTURES_URL = new URL("./fixtures/", import.meta.url);
const TUNED_FILE = "brain-dumps.json";

// brain-dumps.json is the set the rules were tuned on. Every brain-dumps-<name>.json beside it was
// written blind by someone who never saw the organizer. A blind set stops measuring generalization
// once rules are written from its cases, so it moves to SEEN_BY_RULES and its label says so; only
// the blind sets still unseen show whether the rules generalize.
// A file that fails to parse is kept with its error, so one bad file fails its own test only.
const SEEN_BY_RULES = new Set(["brain-dumps-heldout.json", "brain-dumps-blind2.json", "brain-dumps-blind3.json"]);
const FIXTURES = readdirSync(FIXTURES_URL)
  .filter((file) => /^brain-dumps(?:-[\w-]+)?\.json$/.test(file))
  .sort((a, b) => (a === TUNED_FILE ? -1 : b === TUNED_FILE ? 1 : a.localeCompare(b)))
  .map((file) => {
    const base = file === TUNED_FILE ? "tuned" : file.slice("brain-dumps-".length, -".json".length);
    const fixture = { file, tuned: file === TUNED_FILE, name: SEEN_BY_RULES.has(file) ? `${base} (tuned)` : base };
    try {
      fixture.cases = JSON.parse(readFileSync(new URL(file, FIXTURES_URL), "utf8")).cases;
    } catch (error) {
      fixture.error = error;
    }
    return fixture;
  });

// Floors for the tuned set only, at 90% of the score CI last reported (100% on every metric),
// rounded down. A general rule may cost a tuned case or two, but not the tuned set as a whole.
// The other sets are report-only, apart from crisis recall.
const THRESHOLDS = {
  todoRecall: 0.9,
  todoPrecision: 0.9,
  threadRecall: 0.9,
  feelingRecall: 0.9,
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

test("the tuned brain-dump fixture is present", () => {
  assert.ok(FIXTURES.some((f) => f.tuned), `${TUNED_FILE} is missing from tests/fixtures`);
});

for (const fixture of FIXTURES) {
  // The tuned set keeps the plain wording it always had in the CI log; any other set is named by its
  // suffix, marked "(tuned)" once rules have been written from it.
  const label = fixture.tuned ? "" : `${fixture.name} `;
  const set = fixture.tuned ? "the fixed brain-dump set" : `the ${fixture.name} brain-dump set`;
  let evaluated = null;
  const evaluation = () => (evaluated ??= evaluate(fixture.cases));

  test(`${set} is well formed`, () => {
    assert.ifError(fixture.error);
    const { cases } = fixture;
    assert.ok(Array.isArray(cases) && cases.length, `${fixture.file} has no cases array`);
    if (fixture.tuned) {
      assert.ok(cases.length >= 45, `only ${cases.length} cases`);
      assert.ok(cases.filter((c) => c.needs_support).length >= 8, "fewer than 8 crisis cases");
    }
    assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, `duplicate case ids in ${fixture.file}`);
    for (const c of cases) {
      assert.equal(typeof c.text, "string", c.id);
      assert.equal(typeof c.needs_support, "boolean", c.id);
      for (const key of ["todos", "not_todos", "threads", "feelings"]) assert.ok(Array.isArray(c[key]), `${c.id}.${key}`);
    }
  });

  test(`every crisis brain dump in ${set} gets the helpline card`, { skip: fixture.error ? "fixture did not parse" : false }, () => {
    const missed = evaluation().crisisCases.filter((r) => !r.flagged).map((r) => r.id);
    assert.deepEqual(missed, [], `${label}crisis missed: ${missed.join(", ")}`);
  });

  test(`organizer scores on ${set}`, { skip: fixture.error ? "fixture did not parse" : false }, (t) => {
    const result = evaluation();
    report(t, label, result);
    if (!fixture.tuned) return;
    const { metrics } = result;
    assert.ok(metrics.todoRecall.value >= THRESHOLDS.todoRecall, "to-do recall fell below its threshold");
    assert.ok(metrics.todoPrecision.value >= THRESHOLDS.todoPrecision, "to-do precision fell below its threshold");
    assert.ok(metrics.threadRecall.value >= THRESHOLDS.threadRecall, "thread recall fell below its threshold");
    assert.ok(metrics.feelingRecall.value >= THRESHOLDS.feelingRecall, "feeling recall fell below its threshold");
    assert.ok(metrics.falseAlarms <= THRESHOLDS.maxFalseAlarms, "too many false crisis alarms");
    assert.ok(metrics.notTodoViolations <= THRESHOLDS.maxNotTodoViolations, "too many not_todos became to-dos");
  });
}

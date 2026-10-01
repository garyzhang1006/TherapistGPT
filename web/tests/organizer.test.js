import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { organize, splitClauses, isSelfCritical } from "../js/organizer.js";
import { mentionsCrisis } from "../js/safety.js";

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

test("a joke about someone killing me is not a task, and the real task beside it stays", () => {
  assert.deepEqual(organize("my coach is going to murder me if i blow another deadline").to_dos, []);
  assert.deepEqual(organize("mom will literally strangle me if the deadline slips").to_dos, []);
  const tasks = organize("my editor is gonna murder me if the deadline slips so i need to send the draft tonight").to_dos.map((t) => t.task);
  assert.deepEqual(tasks, ["Send the draft"]);
});

test("a due date with only a pronoun for the thing is not a task by itself", () => {
  for (const text of ["it is due on monday", "theyre both due thursday", "its due tmrw too"]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
  assert.match(organize("the lab writeup is due monday").to_dos[0].task, /lab writeup/);
});

test("a vague it or the form carries the thing named just before it", () => {
  assert.deepEqual(organize("bio quiz tmrw, need to study for it").to_dos.map((t) => t.task), ["Study for the bio quiz"]);
  const tasks = organize("passport appointment saturday. i have to fill out the form").to_dos.map((t) => t.task);
  assert.ok(tasks.includes("Fill out the form for the passport appointment"), tasks.join(" | "));
  assert.deepEqual(organize("ugh need to finish it").to_dos, []);
});

test("hiding an injury and settling affairs never show up as to-dos", () => {
  for (const text of [
    "need to grab a big scarf so nobody notices the bruises",
    "have to wear jeans to the pool party so my friends dont see the marks",
  ]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
  // Giving belongings away beside a crisis phrase marks every errand as part of a goodbye.
  assert.deepEqual(organize("i want to kill myself. gave my bike to my neighbor. need to return the drill to my uncle").to_dos, []);
  assert.deepEqual(organize("left farewell notes for my friends. have to sell the car so nobody is stuck with it").to_dos, []);
  // An ordinary crisis dump keeps its chores.
  assert.equal(organize("i want to kill myself. need to return the drill to my uncle").to_dos.length, 1);
});

test("a follow-up that only says them and it stays with the errand it belongs to", () => {
  assert.deepEqual(organize("need to email the landlord and ask him to fix it").to_dos.map((t) => t.task), ["Email the landlord and ask him to fix it"]);
  assert.deepEqual(organize("need to call the clinic and book a checkup").to_dos.map((t) => t.task), ["Call the clinic", "Book a checkup"]);
});

test("him or her in a gift task means the person named before it", () => {
  const tasks = organize("my sisters graduation is friday so i need to buy her a gift").to_dos.map((t) => t.task);
  assert.deepEqual(tasks, ["Buy my sister a gift"]);
  assert.deepEqual(organize("my mom is sick. need to get her meds").to_dos.map((t) => t.task), ["Get her meds"]);
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

test("plans that already fell through are not to-dos, but plans still ahead are", () => {
  for (const text of [
    "i was supposed to go to jess's party but i didn't",
    "we were supposed to call grandma but we couldnt",
    "i was supposed to go to jess's party last night but i didnt and now everyone is mad at me",
  ]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
  assert.match(organize("i'm supposed to call mom tonight").to_dos[0].task, /^Call mom/);
});

test("a promise to my someone is a to-do", () => {
  assert.equal(organize("i told my landlord id fix the screen door").to_dos[0].task, "Fix the screen door");
  assert.equal(organize("told the team i would send notes").to_dos[0].task, "Send notes");
});

test("a request from a boss or a doctor is the task, even after a preamble", () => {
  assert.equal(organize("cant think straight today my manager wants the budget slides by friday").to_dos[0].task, "Finish the budget slides by friday");
  assert.equal(organize("dentist wants me to come in for a cleaning").to_dos[0].task, "See the dentist for a cleaning");
  assert.equal(organize("the nurse told me to get bloodwork done").to_dos[0].task, "Get bloodwork done");
});

test("a to-do keeps the task and leaves the feeling about it behind", () => {
  const { to_dos } = organize("I need to finish my thesis chapter and I haven't opened it in a week");
  assert.equal(to_dos[0].task, "Finish my thesis chapter");
});

test("a verdict on the day is not a to-do, but a named thing still waiting is", () => {
  for (const text of ["i cant even do anything right", "i havent done anything productive today", "i havent done anything all day"]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
  assert.equal(organize("i cant even do anything right").kinder_view.length, 1);
  assert.equal(organize("i havent eaten anything all day").to_dos[0].task, "Eat something");
  assert.equal(organize("i still havent emailed my advisor").to_dos[0].task, "Email my advisor");
});

test("a habit that slipped for days is not a to-do, but one thing still waiting is", () => {
  for (const text of ["i havent called my sister in weeks", "havent replied to anyone for a few days"]) {
    assert.deepEqual(organize(text).to_dos, [], text);
  }
  assert.equal(organize("i havent paid the water bill, its been on my mind for weeks").to_dos[0].task, "Pay the water bill");
});

test("a feeling that runs on without a break is cut from the to-do", () => {
  assert.equal(organize("need to call the insurance office I really feel sick about it").to_dos[0].task, "Call the insurance office");
  assert.deepEqual(organize("i havent done that yet i feel like im sinking").to_dos, []);
});

test("only chores left to do become to-dos", () => {
  assert.equal(organize("i have 3 chapters left to read").to_dos[0].task, "Read 3 chapters");
  assert.deepEqual(organize("i have a few days left to live").to_dos, []);
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

test("isSelfCritical matches the thoughts that get a kinder view, and nothing else", () => {
  for (const text of ["im such a failure", "I’m so stupid", "i hate myself", "I feel like a burden"]) assert.equal(isSelfCritical(text), true, text);
  for (const text of ["I always love seeing my dog", "need to do laundry", "my mom called"]) assert.equal(isSelfCritical(text), false, text);
});

test("feelings come from feeling words, not colors or objects", () => {
  assert.deepEqual(organize("wore my grey hoodie, got a flat tire, told him to leave me alone").feelings, []);
  assert.ok(organize("i miss sam so much").feelings.includes("sad"));
});

test("too many topics fold into Everything else without losing any topic", () => {
  const out = organize("my exam is monday. my boss yelled. rent is due. my mom called. i can't sleep. my room is a mess");
  assert.equal(out.threads.length, 5);
  assert.equal(out.threads[4].title, "Everything else");
  assert.equal(out.threads.flatMap((t) => t.points).length, 6);
});

test("a meal already missed goes to the small step, not the to-do list", () => {
  const out = organize("forgot to eat breakfast again today");
  assert.deepEqual(out.to_dos, []);
  assert.match(out.one_small_step, /food/);
  assert.equal(organize("forgot to pay the phone bill").to_dos[0].task, "Pay the phone bill");
});

test("not eating comes before anything else in the one small step", () => {
  const out = organize("i need to email my professor. i haven't eaten since breakfast");
  assert.match(out.one_small_step, /food/);
});

test("the one small step names the to-do it comes from", () => {
  assert.match(organize("- laundry\n- text sam back").one_small_step, /^Text sam back: type one short line/);
});

test("crisis words sit under Inside your head, not the topic they mention", () => {
  const out = organize("i have to pay rent. i just want to sleep and never wake up");
  const home = out.threads.find((t) => t.points.some((p) => /never wake up/.test(p)));
  assert.equal(home.title, "Inside your head");
});

test("a comma before a crisis phrase does not split off a calm-looking piece of it", () => {
  const points = organize("i just want to sleep, and never wake up").threads.flatMap((t) => t.points);
  assert.ok(points.filter((p) => /wake up/i.test(p)).every(mentionsCrisis), points.join(" | "));
});

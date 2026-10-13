import { test } from "node:test";
import assert from "node:assert/strict";
import { organizeText, looksValid, normalizeEndpoint, loadSettings, saveSettings, testConnection } from "../js/engine.js";
import { mentionsCrisis, applySafetyFloor } from "../js/safety.js";

test("device engine returns valid output with no network", async () => {
  const { result, engine, notice } = await organizeText("I need to do the dishes and I'm so tired", { engine: "device", endpoint: "" });
  assert.equal(engine, "device");
  assert.equal(notice, "");
  assert.ok(looksValid(result));
});

test("a broken model endpoint falls back to the device with a notice", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const { result, engine, notice } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
  assert.equal(engine, "device");
  assert.match(notice, /500/);
  assert.ok(looksValid(result));
});

test("network and parse failures get a plain-language notice", async () => {
  for (const fail of [
    async () => { throw new TypeError("Failed to fetch"); },
    async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError("Unexpected token '<'"); } }),
  ]) {
    globalThis.fetch = fail;
    const { notice } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
    assert.equal(notice, "Couldn't reach your model. This was organized on your device instead.");
  }
});

test("a malformed model reply is rejected and falls back", async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ summary: "<img src=x onerror=alert(1)>" }) });
  const { engine } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
  assert.equal(engine, "device");
});

test("a reply with null entries or a thread with no points is called unreadable, not unreachable", async () => {
  const good = {
    summary: "You're tired.", feelings: ["tired"], threads: [{ title: "Now", points: ["Tired"] }],
    to_dos: [{ task: "Rest", first_step: "Sit down." }], kinder_view: [{ thought: "I'm lazy", reframe: "You're tired." }],
    one_small_step: "Rest.", needs_support: false,
  };
  assert.ok(looksValid(good));
  for (const bad of [
    { ...good, threads: [null] },
    { ...good, threads: [{ title: "Now", points: [] }] },
    { ...good, to_dos: [null] },
    { ...good, kinder_view: [null] },
  ]) {
    assert.equal(looksValid(bad), false);
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => bad });
    const { engine, notice } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
    assert.equal(engine, "device");
    assert.match(notice, /couldn't read/);
  }
});

test("a health answer that isn't a JSON object gets a plain explanation", async () => {
  for (const json of [async () => { throw new SyntaxError("Unexpected token '<'"); }, async () => null, async () => 5]) {
    globalThis.fetch = async () => ({ ok: true, status: 200, json });
    await assert.rejects(testConnection("https://example.invalid"), /isn't a TherapistGPT model/);
  }
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: false }) });
  await assert.rejects(testConnection("https://example.invalid"), /hasn't finished loading/);
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) });
  assert.equal(await testConnection("https://example.invalid"), true);
});

test("Test connection checks the access key the way a sort would send it", async () => {
  const calls = [];
  let keyStatus = 422;
  globalThis.fetch = async (url, options) => {
    calls.push({ url, key: options.headers?.["X-API-Key"] });
    if (url.endsWith("/health")) return { ok: true, status: 200, json: async () => ({ ok: true }) };
    return { ok: false, status: keyStatus, json: async () => ({}) };
  };
  assert.equal(await testConnection("https://example.invalid", "right-key"), true);
  assert.deepEqual(calls.at(-1), { url: "https://example.invalid/organize", key: "right-key" });
  keyStatus = 401;
  await assert.rejects(testConnection("https://example.invalid", "wrong-key"), /access key is missing or wrong/);

  calls.length = 0;
  // A curly quote and a zero-width space, the usual strays in a pasted key.
  const [curly, zeroWidth] = [String.fromCharCode(0x201c), String.fromCharCode(0x200b)];
  await assert.rejects(testConnection("https://example.invalid", `${curly}key${curly}`), /can't be sent/);
  assert.equal(calls.length, 0);
  const { notice } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid", apiKey: `key${zeroWidth}` });
  assert.match(notice, /can't be sent/);
  assert.equal(calls.length, 0);
});

test("plain http endpoints are refused unless they are localhost", async () => {
  globalThis.fetch = async () => assert.fail("should not fetch");
  const { notice } = await organizeText("so tired", { engine: "model", endpoint: "http://example.com" });
  assert.match(notice, /https/);
});

test("an address pasted without https gets it added", () => {
  assert.equal(normalizeEndpoint("  my-space.hf.space/ "), "https://my-space.hf.space");
  assert.equal(normalizeEndpoint("http://localhost:8000"), "http://localhost:8000");
  assert.equal(normalizeEndpoint("https://my-space.hf.space/?logs=container"), "https://my-space.hf.space");
  assert.equal(normalizeEndpoint("https://my-space.hf.space/#app"), "https://my-space.hf.space");
  assert.equal(normalizeEndpoint("https://my-space.hf.space/api/?a=1#b"), "https://my-space.hf.space/api");
});

test("an address that can't be parsed gets a plain explanation", () => {
  for (const bad of ["not a url at all", "hello", "https://", "ftp://"]) {
    assert.throws(() => normalizeEndpoint(bad), /isn't a web address/, bad);
  }
});

test("the keyword safety floor still applies to a model that missed a crisis", async () => {
  const modelOut = {
    summary: "You're tired.", feelings: [], threads: [{ title: "Now", points: ["Tired", "i want to die"] }],
    to_dos: [{ task: "i want to kill myself", first_step: "Rest." }], kinder_view: [], one_small_step: "Rest.", needs_support: false,
  };
  assert.equal(applySafetyFloor("i want to die", modelOut).needs_support, true);
  // A model reply to calm words still loses any crisis line it invents.
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => modelOut });
  const { result, engine } = await organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
  assert.equal(engine, "model");
  assert.deepEqual(result.to_dos, []);
  assert.deepEqual(result.threads[0].points, ["Tired"]);
});

test("crisis words get the help card at once and are never sent to the model", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return new Promise(() => {});
  };
  const { result, engine, notice } = await organizeText("i want to die", { engine: "model", endpoint: "https://example.invalid" });
  assert.equal(calls, 0);
  assert.equal(engine, "device");
  assert.equal(result.needs_support, true);
  assert.ok(looksValid(result));
  assert.match(notice, /not sent to your model/);
});

test("device results never print a crisis sentence back and stay renderable", async () => {
  for (const text of [
    "i want to kill myself",
    "i have a chem quiz tmrw and rent is late and honestly i dont want to be here anymore",
    "i just want to sleep, and never wake up",
    // A period, a line break or "and then" between the halves of one crisis thought, and a reason word
    // that ties a means to it. Neither half may come back as a to-do or a calm-looking point.
    "I need to take all my pills\nand never wake up",
    "I need to take all my pills. And never wake up.",
    "i need to go to sleep and then never wake up",
    "i want to go to sleep. and never wake up",
    "need to buy a rope so i can hang myself",
    "need to pick up more pills because i want to die",
    "need to buy a rope. so i can hang myself",
    "i want to die and never wake up",
    "i wanna die and not wake up",
    "i want to die so i need to take all my pills",
    "i want to die, i have a bottle of pills in my drawer",
    "need to buy a rope and hang myself",
    "need to buy a rope. i want to hang myself",
    "need to buy pills and then i can kill myself",
    "i need to take all my pills anyway i want to die",
    "i need to go to sleep and then\nnever wake up",
  ]) {
    const { result } = await organizeText(text, { engine: "device", endpoint: "" });
    assert.ok(looksValid(result), text);
    assert.equal(result.needs_support, true, text);
    assert.ok(result.threads.every((t) => t.points.length && t.points.every((p) => !mentionsCrisis(p))), text);
    // A clause split off from its crisis phrase can look calm to mentionsCrisis, so check the words too.
    assert.ok(result.threads.every((t) => t.points.every((p) => !/wake up|pills|rope|sleep/i.test(p))), text);
    assert.ok(result.to_dos.every((t) => !/pills|rope|sleep/i.test(t.task)), `${text}: ${result.to_dos.map((t) => t.task).join(" | ")}`);
  }
});

test("a reply whose body stalls still times out and falls back", { timeout: 5000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    status: 200,
    // Headers arrived, but the body never ends until the request is aborted.
    json: () =>
      new Promise((_resolve, reject) => {
        const fail = () => reject(new DOMException("The operation was aborted.", "AbortError"));
        if (signal.aborted) fail();
        else signal.addEventListener("abort", fail);
      }),
  });
  const pending = organizeText("so tired today", { engine: "model", endpoint: "https://example.invalid" });
  await new Promise((resolve) => setImmediate(resolve));
  t.mock.timers.tick(60000);
  const { engine, notice } = await pending;
  assert.equal(engine, "device");
  assert.match(notice, /took too long/);
});

test("settings survive the visit when storage is blocked", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: storage is blocked");
    },
  });
  try {
    saveSettings({ engine: "model", endpoint: "https://a.hf.space", apiKey: "" });
    assert.equal(loadSettings().endpoint, "https://a.hf.space");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

test("a save that storage refuses still wins over the older stored copy", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const stored = new Map([["therapistgpt.settings", JSON.stringify({ engine: "model", endpoint: "https://old.hf.space", apiKey: "" })]]);
  let full = true;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => stored.get(key) ?? null,
      setItem(key, value) {
        if (full) throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
        stored.set(key, value);
      },
    },
  });
  try {
    saveSettings({ engine: "device", endpoint: "", apiKey: "" });
    assert.equal(loadSettings().engine, "device");
    // Once a save goes through, storage is the source again, so another tab's later save is seen.
    full = false;
    saveSettings({ engine: "device", endpoint: "", apiKey: "" });
    stored.set("therapistgpt.settings", JSON.stringify({ engine: "model", endpoint: "https://new.hf.space", apiKey: "" }));
    assert.equal(loadSettings().endpoint, "https://new.hf.space");
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else delete globalThis.localStorage;
  }
});

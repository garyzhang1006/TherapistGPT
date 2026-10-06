import { test } from "node:test";
import assert from "node:assert/strict";
import { organizeText, looksValid, normalizeEndpoint, loadSettings, saveSettings } from "../js/engine.js";
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

test("plain http endpoints are refused unless they are localhost", async () => {
  globalThis.fetch = async () => assert.fail("should not fetch");
  const { notice } = await organizeText("so tired", { engine: "model", endpoint: "http://example.com" });
  assert.match(notice, /https/);
});

test("an address pasted without https gets it added", () => {
  assert.equal(normalizeEndpoint("  my-space.hf.space/ "), "https://my-space.hf.space");
  assert.equal(normalizeEndpoint("http://localhost:8000"), "http://localhost:8000");
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
  ]) {
    const { result } = await organizeText(text, { engine: "device", endpoint: "" });
    assert.ok(looksValid(result), text);
    assert.equal(result.needs_support, true, text);
    assert.ok(result.threads.every((t) => t.points.length && t.points.every((p) => !mentionsCrisis(p))), text);
    // A clause split off from its crisis phrase can look calm to mentionsCrisis, so check the words too.
    assert.ok(result.threads.every((t) => t.points.every((p) => !/wake up/i.test(p))), text);
  }
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

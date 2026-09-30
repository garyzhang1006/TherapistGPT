import { test } from "node:test";
import assert from "node:assert/strict";
import { organizeText, looksValid, normalizeEndpoint } from "../js/engine.js";

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
    summary: "You're tired.", feelings: [], threads: [{ title: "Now", points: ["Tired"] }],
    to_dos: [], kinder_view: [], one_small_step: "Rest.", needs_support: false,
  };
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => modelOut });
  const { result, engine } = await organizeText("i want to die", { engine: "model", endpoint: "https://example.invalid" });
  assert.equal(engine, "model");
  assert.equal(result.needs_support, true);
});

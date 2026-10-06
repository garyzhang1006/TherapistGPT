import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../index.html");
const css = read("../css/styles.css");

// The way to the helplines must not depend on app.js: if the module fails to load, a button that
// only app.js wires up does nothing. The browser job in ci.yml clicks these with JavaScript off.
test("every way to the helplines is a link that works without JavaScript", () => {
  const openers = [...index.matchAll(/<(\w+)\b[^>]*data-open="help-dialog"[^>]*>/g)];
  assert.ok(openers.length >= 2, "expected the top-bar and footer help openers");
  for (const [tag, name] of openers) {
    assert.equal(name, "a", `a help opener is a <${name}>, not a link: ${tag}`);
    assert.match(tag, /href="#help-dialog"/, tag);
  }
  assert.match(css, /#help-dialog:target:not\(\[open\]\)\s*\{[^}]*display:\s*block/, "styles.css must show #help-dialog when it is the link target");
  const dialog = index.match(/<dialog id="help-dialog"[\s\S]*?<\/dialog>/)?.[0] ?? "";
  for (const href of ["tel:988", "sms:988"]) assert.ok(dialog.includes(`href="${href}"`), `the help dialog has no ${href} link`);
});

test("the brain dump form cannot send the words anywhere before app.js runs", () => {
  const form = index.match(/<form id="dump-form"[^>]*>/)?.[0];
  assert.ok(form, "<form id=\"dump-form\"> not found in index.html");
  assert.match(form, /method="dialog"/, "outside a dialog, method=\"dialog\" submits nothing");
  const textarea = index.match(/<textarea id="dump"[^>]*>/)?.[0];
  assert.ok(textarea, "<textarea id=\"dump\"> not found in index.html");
  assert.doesNotMatch(textarea, /\bname=/, "a named textarea would put the words in the address on a plain GET");
});

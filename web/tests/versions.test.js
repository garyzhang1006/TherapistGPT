import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// A mix of fresh and cached modules breaks the page, so every asset URL must share one version.
test("index.html and every local import use the same cache version", () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
  const found = [...read("../index.html").matchAll(/\?v=(\d+)/g)].map((m) => m[1]);
  for (const file of readdirSync(new URL("../js/", import.meta.url))) {
    const source = read(`../js/${file}`);
    for (const m of source.matchAll(/from "\.\/[\w-]+\.js(\?v=\d+)?"/g)) {
      assert.ok(m[1], `${file}: unversioned import ${m[0]}`);
      found.push(m[1].slice(3));
    }
  }
  assert.ok(found.length > 2);
  assert.equal(new Set(found).size, 1, `versions differ: ${[...new Set(found)].join(", ")}`);
});

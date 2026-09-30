import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const index = read("../index.html");
const sw = read("../sw.js");
const manifest = JSON.parse(read("../manifest.json"));

// The PNG icons are drawn from assets/icon.svg by the Pages workflow, so they exist on the site but
// not in git. Its "render <size> <path>" lines say which ones.
const RENDERED = new Set(
  [...read("../../.github/workflows/pages.yml").matchAll(/^\s*render \d+ (\S+)$/gm)].map((m) => m[1])
);
const onSite = (path) => existsSync(new URL(`../${path}`, import.meta.url)) || RENDERED.has(path);

// On a ?v= bump, sw.js needs only its VERSION changed; the precache URLs are built from it.
const VERSION = sw.match(/^const VERSION = "(\d+)";$/m)?.[1];
const PRECACHE = new Set(
  [...(sw.match(/const PRECACHE = \[([\s\S]*?)\];/)?.[1] ?? "").matchAll(/["`]([^"`]+)["`]/g)].map((m) =>
    m[1].replaceAll("${VERSION}", VERSION)
  )
);

test("the manifest has what browsers need to offer an install", () => {
  assert.match(index, /<link rel="manifest" href="manifest\.json" \/>/);
  assert.equal(manifest.name, "TherapistGPT");
  assert.equal(manifest.display, "standalone");
  // Relative, so the app stays inside /TherapistGPT/ on GitHub Pages instead of the site root.
  for (const key of ["start_url", "scope"]) {
    assert.ok(manifest[key] && !/^(\/|[a-z]+:)/i.test(manifest[key]), `${key} must be relative: ${manifest[key]}`);
  }
  const darkBg = read("../css/styles.css").match(/:root \{\s*--bg: (#[0-9a-f]{6});/)?.[1];
  assert.ok(darkBg, "could not find --bg in the first :root block of styles.css");
  assert.equal(manifest.background_color, darkBg);
  assert.equal(manifest.theme_color, darkBg);
  for (const size of ["192x192", "512x512"]) {
    assert.ok(
      manifest.icons.some((icon) => icon.sizes === size && icon.type === "image/png" && (icon.purpose ?? "any").split(" ").includes("any")),
      `Chrome needs a ${size} PNG icon with purpose any`
    );
  }
});

test("every icon the page or manifest names exists on the site", () => {
  const icons = [
    ...manifest.icons.map((icon) => icon.src),
    ...[...index.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(icons.length >= 5);
  for (const icon of icons) assert.ok(onSite(icon), `missing icon: ${icon}`);
  assert.ok(RENDERED.size > 0 && existsSync(new URL("../assets/icon.svg", import.meta.url)), "icons render from assets/icon.svg");
});

test("sw.js caches under the same version as the ?v= strings", () => {
  assert.ok(VERSION, "sw.js must declare const VERSION = \"<number>\";");
  const found = new Set([...index.matchAll(/\?v=(\d+)/g)].map((m) => m[1]));
  assert.deepEqual([...found], [VERSION], `index.html uses ?v=${[...found].join(", ")} but sw.js has VERSION ${VERSION}`);
});

test("the precache holds every file the page loads, and each one exists", () => {
  const needed = ["index.html", ...[...index.matchAll(/(?:href|src)="([^"]+\?v=\d+)"/g)].map((m) => m[1])];
  for (const file of readdirSync(new URL("../js/", import.meta.url))) {
    for (const m of read(`../js/${file}`).matchAll(/from "\.\/([\w-]+\.js\?v=\d+)"/g)) needed.push(`js/${m[1]}`);
  }
  for (const font of readdirSync(new URL("../fonts/", import.meta.url))) {
    if (font.endsWith(".woff2")) needed.push(`fonts/${font}`);
  }
  needed.push(...manifest.icons.map((icon) => icon.src));
  needed.push(...[...index.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)].map((m) => m[1]));
  for (const url of needed) assert.ok(PRECACHE.has(url), `sw.js PRECACHE is missing ${url}`);
  for (const url of PRECACHE) assert.ok(onSite(url.replace(/\?v=\d+$/, "")), `sw.js precaches ${url}, which does not exist`);
});

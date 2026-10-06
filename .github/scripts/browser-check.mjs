// Loads the app in Chromium with JavaScript off and on, and checks the two things that must never
// depend on app.js: reaching the helplines, and the brain dump never leaving the page. Run by the
// browser job in .github/workflows/ci.yml against a copy of web/ served on the runner:
//   SITE_URL=http://localhost:8000/ node .github/scripts/browser-check.mjs
import { chromium } from "playwright";

const SITE_URL = process.env.SITE_URL || "http://localhost:8000/";
// A word that appears nowhere in the app, so finding it in the address can only mean the dump leaked.
const SECRET = "zebraumbrella41";
// Everyday text with no crisis words, so the results show the calm layout.
const DUMP = `bio exam tmrw and i need to pay the phone bill ${SECRET}`;

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      if ((await fetch(SITE_URL)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Nothing answered at ${SITE_URL} after 15 seconds. Did the http.server step start?`);
}

const settles = (locator, state) =>
  locator.first().waitFor({ state, timeout: 15000 }).then(() => true, () => false);

function check(ok, what) {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok - ${what}`);
}

async function withPage(browser, options, run) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", ...options });
  const page = await context.newPage();
  try {
    await page.goto(SITE_URL, { waitUntil: "load" });
    await run(page);
  } finally {
    await context.close();
  }
}

const call988 = (page) => page.locator('#help-dialog a[href="tel:988"]');
const leaked = (page) => page.url().includes(SECRET) || page.url().includes("dump=");

await waitForServer();
const browser = await chromium.launch();
try {
  await withPage(browser, { javaScriptEnabled: false }, async (page) => {
    check(!(await call988(page).isVisible()), "with JavaScript off, the helplines start hidden");
    for (const name of ["Need help now?", "find support"]) {
      await page.goto(SITE_URL, { waitUntil: "load" });
      await page.getByRole("link", { name }).click();
      check(await settles(call988(page), "visible"), `with JavaScript off, "${name}" shows the Call 988 link`);
    }

    await page.goto(SITE_URL, { waitUntil: "load" });
    await page.locator("#dump").fill(DUMP);
    await page.locator("#organize-btn").click();
    await page.waitForTimeout(1000);
    check(!leaked(page), `with JavaScript off, Sort keeps the words out of the address (${page.url()})`);
  });

  await withPage(browser, {}, async (page) => {
    await page.getByRole("link", { name: "Need help now?" }).click();
    check(await settles(page.locator("#help-dialog[open]"), "visible"), 'with JavaScript on, "Need help now?" opens the help dialog');
    check(!page.url().includes("#help-dialog"), `with JavaScript on, the address keeps no #help-dialog (${page.url()})`);
    await page.keyboard.press("Escape");
    check(await settles(page.locator("#help-dialog"), "hidden"), "with JavaScript on, Escape closes the help dialog and no copy stays on the page");

    await page.locator("#dump").fill(DUMP);
    await page.locator("#organize-btn").click();
    check(await settles(page.locator("#result-cards .card"), "visible"), "with JavaScript on, Sort shows the results");
    check(!leaked(page), `with JavaScript on, Sort keeps the words out of the address (${page.url()})`);

    // Ticks live in page memory only. The old results stay in the DOM while hidden, so the check
    // waits for a visible ticked box, which only the second sort can draw.
    await page.locator("#result-cards .todo label").first().click();
    await page.getByRole("button", { name: "Back to my words" }).click();
    await page.locator("#organize-btn").click();
    check(await settles(page.locator("#result-cards .todo input:checked"), "visible"), "with JavaScript on, a ticked to-do stays ticked after Back and a second sort");
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    check(!stored.includes(SECRET), "with JavaScript on, nothing in local or session storage holds the sorted words");

    // With a model address saved, crisis words get the help card at once and never reach the model.
    // The calm dump after it proves the route does catch requests, so zero means none were made.
    const sent = [];
    await page.route("https://example.invalid/**", (route) => {
      sent.push(route.request().url());
      return route.abort();
    });
    await page.evaluate(() =>
      localStorage.setItem("therapistgpt.settings", JSON.stringify({ engine: "model", endpoint: "https://example.invalid", apiKey: "" })),
    );
    await page.getByRole("button", { name: "Back to my words" }).click();
    await page.locator("#dump").fill(`i want to die ${SECRET}`);
    await page.locator("#organize-btn").click();
    const shown = await page.locator("#result-cards .crisis").first().waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false);
    check(shown && sent.length === 0, `with a model saved, crisis words show the help card within 3 seconds and are never sent (${sent.length} sent)`);
    await page.getByRole("button", { name: "Back to my words" }).click();
    await page.locator("#dump").fill(DUMP);
    await page.locator("#organize-btn").click();
    await settles(page.locator("#engine-note", { hasText: "organized on your device instead" }), "visible");
    check(sent.length > 0, "with a model saved, calm words are still sent to the model");
  });
} finally {
  await browser.close();
}

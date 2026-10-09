// Captures the README screenshots from a deployed copy of the site. Run by .github/workflows/screenshots.yml:
//   SITE_URL=https://garyzhang1006.github.io/TherapistGPT/ OUT_DIR=screenshots node .github/scripts/screenshots.mjs
// The browser job in ci.yml sets ALL_STATES=1 against its own copy of web/, which adds the light theme on
// both sizes, both dialogs and the crisis card, so a pull request's look can be checked from the run page.
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const SITE_URL = process.env.SITE_URL || "https://garyzhang1006.github.io/TherapistGPT/";
const OUT_DIR = process.env.OUT_DIR || "screenshots";
const ALL_STATES = process.env.ALL_STATES === "1";

// A plain, everyday dump. It must never contain crisis words: the screenshots are public, and a crisis
// card would replace the calm layout they are meant to show. run() below fails if one appears anyway.
const DUMP =
  "idk where to even start. bio exam tmrw and i havent studied, my boss wants me to pick up another shift, " +
  "mom keeps calling and i feel guilty for not picking up. i need to pay the phone bill. im so tired";
// Only for the ALL_STATES crisis shot, which never goes in the README. The same phrase the browser check uses.
const CRISIS_DUMP = "i want to die and i cant tell anyone";

const VIEWPORTS = {
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
};

try {
  new URL(SITE_URL);
} catch {
  throw new Error(`SITE_URL is not a valid URL: "${SITE_URL}". Pass a full address such as https://garyzhang1006.github.io/TherapistGPT/.`);
}

// Fails with the element's name and the page address, so a renamed id is obvious from the log.
async function need(page, selector, what) {
  // waitFor is strict and throws when a selector matches several elements, as the result cards do.
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: "visible", timeout: 15000 });
  } catch {
    throw new Error(`Expected ${what} (${selector}) to be visible on ${page.url()}, but it never appeared. Did the id change in web/index.html?`);
  }
  return locator;
}

async function capture(page, name) {
  // Swapped-in web fonts change line breaks, so wait for them; and park the mouse so no hover state shows.
  await page.evaluate(() => document.fonts.ready.then(() => true));
  await page.mouse.move(0, 0);
  const file = path.join(OUT_DIR, name);
  await page.screenshot({ path: file, fullPage: true });
  console.log(`saved ${file}`);
}

async function sort(page, text) {
  await (await need(page, "#dump", "the brain dump textarea")).fill(text);
  await page.getByRole("button", { name: "Sort my thoughts" }).click();
  await need(page, "#result-view", "the results view");
  await need(page, "#result-cards .card", "at least one result card");
}

async function shoot(browser, size, scheme) {
  // Reduced motion skips the drifting fragments and the cards' fade-in, so every shot shows the settled page.
  const context = await browser.newContext({ ...VIEWPORTS[size], colorScheme: scheme, reducedMotion: "reduce" });
  const page = await context.newPage();
  const suffix = scheme === "dark" ? "" : "-light";
  try {
    const response = await page.goto(SITE_URL, { waitUntil: "load" });
    if (!response || !response.ok()) throw new Error(`Loading ${SITE_URL} returned HTTP ${response ? response.status() : "no response"}.`);

    await need(page, "#dump", "the brain dump textarea");
    await need(page, "#organize-btn", 'the "Sort my thoughts" button');
    await capture(page, `write-${size}${suffix}.png`);

    await sort(page, DUMP);
    if ((await page.locator("#result-cards .crisis").count()) > 0) {
      throw new Error("The sample dump produced a crisis card. Change DUMP in .github/scripts/screenshots.mjs to everyday text.");
    }
    await capture(page, `results-${size}${suffix}.png`);

    if (!ALL_STATES) {
      if (size === "phone") {
        const toggle = await need(page, "#theme-toggle", "the theme toggle");
        await toggle.click();
        const theme = await page.evaluate(() => document.documentElement.dataset.theme);
        if (theme !== "light") throw new Error(`Clicking #theme-toggle left data-theme as "${theme}", expected "light".`);
        await capture(page, "results-phone-light.png");
      }
      return;
    }

    await page.getByRole("link", { name: "Need help now?" }).click();
    await need(page, "#help-dialog[open]", "the help dialog");
    await capture(page, `help-${size}${suffix}.png`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Settings" }).click();
    await need(page, "#settings-dialog[open]", "the settings dialog");
    await capture(page, `settings-${size}${suffix}.png`);
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Back to my words" }).click();
    await sort(page, CRISIS_DUMP);
    await need(page, "#result-cards .crisis", "the crisis card");
    await capture(page, `crisis-${size}${suffix}.png`);
  } finally {
    await context.close();
  }
}

await mkdir(OUT_DIR, { recursive: true });
const browser = await chromium.launch();
try {
  for (const size of Object.keys(VIEWPORTS)) {
    for (const scheme of ALL_STATES ? ["dark", "light"] : ["dark"]) await shoot(browser, size, scheme);
  }
} finally {
  await browser.close();
}
